import { useD2Definitions } from 'app/manifest/selectors';
import { killTrackerSocketTypeHash } from 'app/search/d2-known-values';
import { getArmorExoticPerkSocket, getSocketsByIndexes } from 'app/utils/socket-utils';
import { DestinySocketCategoryStyle } from 'bungie-api-ts/destiny2';
import clsx from 'clsx';
import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { useSelector } from 'react-redux';
import { DimAdjustedItemPlug } from '../compare/types';
import { DimItem, DimPlug, DimSocket } from '../inventory/item-types';
import { wishListSelector } from '../wishlists/selectors';
import ArchetypeSocket, { ArchetypeRow } from './ArchetypeSocket';
import './ItemSockets.scss';
import styles from './ItemSocketsGeneral.m.scss';
import Socket from './Socket';
import SocketDetails from './SocketDetails';

interface Props {
  item: DimItem;
  /** minimal style used for loadout generator and compare */
  minimal?: boolean;
  updateSocketComparePlug?(value: { item: DimItem; socket: DimSocket; plug: DimPlug }): void;
  adjustedItemPlugs?: DimAdjustedItemPlug;
}

export default function ItemSocketsGeneral({
  item,
  minimal,
  updateSocketComparePlug,
  adjustedItemPlugs,
}: Props) {
  const defs = useD2Definitions();
  const wishlistRoll = useSelector(wishListSelector(item));
  const [socketInMenu, setSocketInMenu] = useState<DimSocket | null>(null);

  const handleSocketClick = (item: DimItem, socket: DimSocket, plug: DimPlug, hasMenu: boolean) => {
    if (hasMenu) {
      setSocketInMenu(socket);
    } else if (updateSocketComparePlug) {
      updateSocketComparePlug({
        item,
        socket,
        plug,
      });
    }
  };

  if (!item.sockets || !defs) {
    return null;
  }

  const exoticArmorPerkSocket = getArmorExoticPerkSocket(item);

  let categories = item.sockets.categories.filter(
    (c) =>
      // hide if there's no sockets in this category
      c.socketIndexes.length > 0 &&
      // hide if this is the energy slot. it's already displayed in ItemDetails
      c.category.categoryStyle !== DestinySocketCategoryStyle.EnergyMeter &&
      // Hidden sockets for intrinsic armor stats
      c.category.uiCategoryStyle !== 2251952357 &&
      // we handle exotic perk specially too
      (!exoticArmorPerkSocket || !c.socketIndexes.includes(exoticArmorPerkSocket?.socketIndex))
  );
  if (minimal) {
    // Only show the first of each style of category
    const categoryStyles = new Set<DestinySocketCategoryStyle>();
    categories = categories.filter((c) => {
      if (!categoryStyles.has(c.category.categoryStyle)) {
        categoryStyles.add(c.category.categoryStyle);
        return true;
      }
      return false;
    });
  }

  return (
    <div className={clsx('item-details', 'sockets', { [styles.minimalSockets]: minimal })}>
      {exoticArmorPerkSocket && (
        <ArchetypeRow minimal={minimal}>
          {exoticArmorPerkSocket?.plugged && (
            <ArchetypeSocket archetypeSocket={exoticArmorPerkSocket} item={item}>
              {!minimal && (
                <div className={styles.exoticDescription}>
                  {exoticArmorPerkSocket.plugged.plugDef.displayProperties.description}
                </div>
              )}
            </ArchetypeSocket>
          )}
        </ArchetypeRow>
      )}
      {categories.map((category) => (
        <div
          key={category.category.hash}
          className={clsx('item-socket-category', categoryStyle(category.category.categoryStyle))}
        >
          {!minimal && (
            <div className="item-socket-category-name">
              {category.category.displayProperties.name}
            </div>
          )}
          <div className="item-sockets">
            {getSocketsByIndexes(item.sockets!, category.socketIndexes).map(
              (socketInfo) =>
                socketInfo.socketDefinition.socketTypeHash !== killTrackerSocketTypeHash && (
                  <Socket
                    key={socketInfo.socketIndex}
                    item={item}
                    socket={socketInfo}
                    wishlistRoll={wishlistRoll}
                    onClick={handleSocketClick}
                    adjustedPlug={adjustedItemPlugs?.[socketInfo.socketIndex]}
                  />
                )
            )}
          </div>
        </div>
      ))}
      {socketInMenu &&
        ReactDOM.createPortal(
          <SocketDetails
            key={socketInMenu.socketIndex}
            item={item}
            socket={socketInMenu}
            onClose={() => setSocketInMenu(null)}
          />,
          document.body
        )}
    </div>
  );
}

/** converts a socket category to a valid css class name */
function categoryStyle(categoryStyle: DestinySocketCategoryStyle) {
  switch (categoryStyle) {
    case DestinySocketCategoryStyle.Unknown:
      return 'item-socket-category-Unknown';
    case DestinySocketCategoryStyle.Reusable:
      return 'item-socket-category-Reusable';
    case DestinySocketCategoryStyle.Consumable:
      return 'item-socket-category-Consumable';
    case DestinySocketCategoryStyle.Unlockable:
      return 'item-socket-category-Unlockable';
    case DestinySocketCategoryStyle.Intrinsic:
      return 'item-socket-category-Intrinsic';
    case DestinySocketCategoryStyle.EnergyMeter:
      return 'item-socket-category-EnergyMeter';
    default:
      return null;
  }
}
