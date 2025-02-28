import { StatHashes } from 'app/../data/d2/generated-enums';
import _ from 'lodash';
import raidModPlugCategoryHashes from '../../../data/d2/raid-mod-plug-category-hashes.json';
import { knownModPlugCategoryHashes } from '../../loadout/known-values';
import { armor2PlugCategoryHashesByName, TOTAL_STAT_HASH } from '../../search/d2-known-values';
import { chainComparator, compareBy } from '../../utils/comparators';
import { infoLog } from '../../utils/log';
import { generateProcessModPermutations } from '../mod-permutations';
import { ArmorStatHashes, ArmorStats, LockableBuckets, StatFilters, StatRanges } from '../types';
import { statTier } from '../utils';
import { canTakeSlotIndependantMods, sortProcessModsOrItems } from './process-utils';
import { SetTracker } from './set-tracker';
import {
  IntermediateProcessArmorSet,
  LockedProcessMods,
  ProcessArmorSet,
  ProcessItem,
  ProcessItemsByBucket,
  ProcessMod,
} from './types';

/** Caps the maximum number of total armor sets that'll be returned */
const RETURNED_ARMOR_SETS = 200;

/**
 * Generate a comparator that sorts first by the total of the considered stats,
 * and then by the individual stats in the order we want. This includes the effects
 * of existing masterwork mods and the upgradeSpendTier
 */
function compareByStatOrder(
  // Ordered list of enabled stats
  orderedConsideredStatHashes: number[],
  // The user's chosen order of all stats, by hash
  statOrder: number[],
  // A map from item to stat values in user-selected order, with masterworks included
  statsCache: Map<ProcessItem, number[]>
) {
  const statHashToOrder: { [statHash: number]: number } = {};
  statOrder.forEach((statHash, index) => (statHashToOrder[statHash] = index));

  return chainComparator<ProcessItem>(
    // First compare by sum of considered stats
    compareBy((i) =>
      _.sumBy(orderedConsideredStatHashes, (h) => -statsCache.get(i)![statHashToOrder[h]])
    ),
    // Then by each stat individually in order
    ...orderedConsideredStatHashes.map((h) =>
      compareBy((i: ProcessItem) => -statsCache.get(i)![statHashToOrder[h]])
    ),
    // Then by overall total
    compareBy((i) => -i.baseStats[TOTAL_STAT_HASH])
  );
}

/**
 * This processes all permutations of armor to build sets
 * @param filteredItems pared down list of items to process sets from
 * @param modStatTotals Stats that are applied to final stat totals, think general and other mod stats
 */
export function process(
  filteredItems: ProcessItemsByBucket,
  /** Selected mods' total contribution to each stat */
  modStatTotals: ArmorStats,
  /** Mods to add onto the sets */
  lockedModMap: LockedProcessMods,
  /** The user's chosen stat order, including disabled stats */
  statOrder: ArmorStatHashes[],
  statFilters: StatFilters
): {
  sets: ProcessArmorSet[];
  combos: number;
  combosWithoutCaps: number;
  statRanges?: StatRanges;
} {
  const pstart = performance.now();

  // TODO: potentially could filter out items that provide more than the maximum of a stat all on their own?

  // Stat types excluding ignored stats
  const orderedConsideredStatHashes = statOrder.filter(
    (statHash) => !statFilters[statHash].ignored
  );

  // This stores the computed min and max value for each stat as we process all sets, so we
  // can display it on the stat filter dropdowns
  const statRanges: StatRanges = _.mapValues(statFilters, (filter) =>
    filter.ignored ? { min: 0, max: 10 } : { min: 10, max: 0 }
  );

  const statsCache: Map<ProcessItem, number[]> = new Map();

  // Precompute the stats of each item in the order the user asked for
  for (const item of [
    ...(filteredItems[LockableBuckets.helmet] || []),
    ...(filteredItems[LockableBuckets.gauntlets] || []),
    ...(filteredItems[LockableBuckets.chest] || []),
    ...(filteredItems[LockableBuckets.leg] || []),
    ...(filteredItems[LockableBuckets.classitem] || []),
  ]) {
    statsCache.set(item, getStatValuesWithMW(item, statOrder));
  }

  // Sort gear by the chosen stats so we consider the likely-best gear first
  const itemComparator = compareByStatOrder(orderedConsideredStatHashes, statOrder, statsCache);
  // TODO: make these a list/map
  const helms = (filteredItems[LockableBuckets.helmet] || []).sort(itemComparator);
  const gaunts = (filteredItems[LockableBuckets.gauntlets] || []).sort(itemComparator);
  const chests = (filteredItems[LockableBuckets.chest] || []).sort(itemComparator);
  const legs = (filteredItems[LockableBuckets.leg] || []).sort(itemComparator);
  // TODO: we used to do these in chunks, where items w/ same stats were considered together. For class items that
  // might still be useful. In practice there are only 1/2 class items you need to care about - all of them that are
  // masterworked and all of them that aren't. I think we may want to go back to grouping like items but we'll need to
  // incorporate modslots and energy maybe.
  const classItems = (filteredItems[LockableBuckets.classitem] || []).sort(itemComparator);

  // We won't search through more than this number of stat combos because it takes too long.
  // On my machine (bhollis) it takes ~1s per 500,000 combos
  const combosLimit = 2_000_000;

  // The maximum possible combos we could have
  const combosWithoutCaps =
    helms.length * gaunts.length * chests.length * legs.length * classItems.length;

  let combos = combosWithoutCaps;

  // If we're over the limit, start trimming down the armor lists starting with the worst among them.
  // Since we're already sorted by total stats descending this should toss the worst items.
  while (combos > combosLimit) {
    const sortedTypes = [helms, gaunts, chests, legs]
      // Don't ever remove the last item in a category
      .filter((items) => items.length > 1)
      // Sort by our same statOrder-aware comparator, but only compare the worst-ranked item in each category
      .sort((a: ProcessItem[], b: ProcessItem[]) =>
        itemComparator(a[a.length - 1], b[b.length - 1])
      );
    // Pop the last item off the worst-sorted list
    sortedTypes[sortedTypes.length - 1].pop();
    // TODO: A smarter version of this would avoid trimming out items that match mod slots we need, somehow
    combos = helms.length * gaunts.length * chests.length * legs.length * classItems.length;
  }

  if (combos < combosWithoutCaps) {
    infoLog(
      'loadout optimizer',
      'Reduced armor combinations from',
      combosWithoutCaps,
      'to',
      combos
    );
  }

  if (combos === 0) {
    return { sets: [], combos: 0, combosWithoutCaps: 0 };
  }

  const setTracker = new SetTracker(RETURNED_ARMOR_SETS);

  let generalMods: ProcessMod[] = [];
  let combatMods: ProcessMod[] = [];
  let raidMods: ProcessMod[] = [];

  for (const [plugCategoryHash, mods] of Object.entries(lockedModMap)) {
    const pch = Number(plugCategoryHash);
    if (pch === armor2PlugCategoryHashesByName.general) {
      generalMods = generalMods.concat(mods);
    } else if (raidModPlugCategoryHashes.includes(pch)) {
      raidMods = raidMods.concat(mods);
    } else if (!knownModPlugCategoryHashes.includes(pch)) {
      combatMods = combatMods.concat(mods);
    }
  }

  const generalModsPermutations = generateProcessModPermutations(
    generalMods.sort(sortProcessModsOrItems)
  );
  const combatModPermutations = generateProcessModPermutations(
    combatMods.sort(sortProcessModsOrItems)
  );
  const raidModPermutations = generateProcessModPermutations(raidMods.sort(sortProcessModsOrItems));
  const hasMods = combatMods.length || raidMods.length || generalMods.length;

  let numSkippedLowTier = 0;
  let numStatRangeExceeded = 0;
  let numCantSlotMods = 0;
  let numInserted = 0;
  let numRejectedAfterInsert = 0;
  let numDoubleExotic = 0;

  // TODO: is there a more efficient iteration order through the sorted items that'd let us quit early? Something that could generate combinations

  for (const helm of helms) {
    for (const gaunt of gaunts) {
      // For each additional piece, skip the whole branch if we've managed to get 2 exotics
      if (gaunt.equippingLabel && gaunt.equippingLabel === helm.equippingLabel) {
        numDoubleExotic += chests.length * legs.length * classItems.length;
        continue;
      }
      for (const chest of chests) {
        if (
          chest.equippingLabel &&
          (chest.equippingLabel === gaunt.equippingLabel ||
            chest.equippingLabel === helm.equippingLabel)
        ) {
          numDoubleExotic += legs.length * classItems.length;
          continue;
        }
        for (const leg of legs) {
          if (
            leg.equippingLabel &&
            (leg.equippingLabel === chest.equippingLabel ||
              leg.equippingLabel === gaunt.equippingLabel ||
              leg.equippingLabel === helm.equippingLabel)
          ) {
            numDoubleExotic += classItems.length;
            continue;
          }

          for (const classItem of classItems) {
            const armor = [helm, gaunt, chest, leg, classItem];

            // TODO: why not just another ordered list?
            // Start with the contribution of mods. Spread operator is slow.
            const stats: ArmorStats = {
              [StatHashes.Mobility]: modStatTotals[StatHashes.Mobility],
              [StatHashes.Resilience]: modStatTotals[StatHashes.Resilience],
              [StatHashes.Recovery]: modStatTotals[StatHashes.Recovery],
              [StatHashes.Discipline]: modStatTotals[StatHashes.Discipline],
              [StatHashes.Intellect]: modStatTotals[StatHashes.Intellect],
              [StatHashes.Strength]: modStatTotals[StatHashes.Strength],
            };
            for (const item of armor) {
              const itemStats = statsCache.get(item)!;
              let index = 0;
              // itemStats are already in the user's chosen stat order
              for (const statHash of statOrder) {
                stats[statHash] = stats[statHash] + itemStats[index];
                // Stats can't exceed 100 even with mods. At least, today they
                // can't - we *could* pass the max value in from the stat def.
                // Math.min is slow.
                if (stats[statHash] > 100) {
                  stats[statHash] = 100;
                }
                index++;
              }
            }

            let totalTier = 0;
            let statRangeExceeded = false;
            for (const statHash of orderedConsideredStatHashes) {
              const tier = statTier(stats[statHash]);

              // Update our global min/max for this stat
              if (tier > statRanges[statHash].max) {
                statRanges[statHash].max = tier;
              }
              if (tier < statRanges[statHash].min) {
                statRanges[statHash].min = tier;
              }

              if (tier > statFilters[statHash].max || tier < statFilters[statHash].min) {
                statRangeExceeded = true;
                break;
              }
              totalTier += tier;
            }

            if (statRangeExceeded) {
              numStatRangeExceeded++;
              continue;
            }

            // Drop this set if it could never make it
            if (!setTracker.couldInsert(totalTier)) {
              numSkippedLowTier++;
              continue;
            }

            // For armour 2 mods we ignore slot specific mods as we prefilter items based on energy requirements
            if (
              hasMods &&
              !canTakeSlotIndependantMods(
                generalModsPermutations,
                combatModPermutations,
                raidModPermutations,
                armor
              )
            ) {
              numCantSlotMods++;
              continue;
            }

            const newArmorSet: IntermediateProcessArmorSet = {
              armor,
              stats,
            };

            // Calculate the "tiers string" here, since most sets don't make it this far
            // A string version of the tier-level of each stat, must be lexically comparable
            let tiers = '';
            for (const statHash of orderedConsideredStatHashes) {
              const tier = statTier(stats[statHash]);
              // Make each stat exactly one code unit so the string compares correctly
              tiers += tier.toString(11);
            }

            numInserted++;
            if (!setTracker.insert(totalTier, tiers, newArmorSet)) {
              numRejectedAfterInsert++;
            }
          }
        }
      }
    }
  }

  const finalSets = setTracker.getArmorSets();

  const totalTime = performance.now() - pstart;
  infoLog(
    'loadout optimizer',
    'found',
    finalSets.length,
    'stat mixes after processing',
    combos,
    'stat combinations in',
    totalTime,
    'ms - ',
    (combos * 1000) / totalTime,
    'combos/s',
    // Split into two objects so console.log will show them all expanded
    {
      numCantSlotMods,
      numSkippedLowTier,
      numStatRangeExceeded,
    },
    {
      numInserted,
      numRejectedAfterInsert,
      numDoubleExotic,
    }
  );

  return { sets: flattenSets(finalSets), combos, combosWithoutCaps, statRanges };
}

/**
 * Gets the stat values of an item with masterwork.
 */
function getStatValuesWithMW(item: ProcessItem, orderedStatValues: number[]) {
  const baseStats = { ...item.baseStats };

  if (item.energy?.capacity === 10) {
    for (const statHash of orderedStatValues) {
      baseStats[statHash] += 2;
    }
  }
  // mapping out from stat values to ensure ordering and that values don't fall below 0 from locked mods
  return orderedStatValues.map((statHash) => Math.max(baseStats[statHash], 0));
}

function flattenSets(sets: IntermediateProcessArmorSet[]): ProcessArmorSet[] {
  return sets.map((set) => ({
    ...set,
    armor: set.armor.map((item) => item.id),
  }));
}
