import { recentSearchesSelector } from 'app/dim-api/selectors';
import CollapsibleTitle from 'app/dim-ui/CollapsibleTitle';
import Dropdown, { Option } from 'app/dim-ui/Dropdown';
import { t } from 'app/i18next-t';
import ConnectedInventoryItem from 'app/inventory/ConnectedInventoryItem';
import { locateItem } from 'app/inventory/locate-item';
import { allItemsSelector } from 'app/inventory/selectors';
import ItemActionsDropdown from 'app/item-actions/ItemActionsDropdown';
import { filterFactorySelector } from 'app/search/search-filter';
import { setSearchQuery } from 'app/shell/actions';
import { AppIcon, searchIcon } from 'app/shell/icons';
import _ from 'lodash';
import React, { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import styles from './RecentItems.m.scss';

export default function RecentItems() {
  const allItems = useSelector(allItemsSelector);
  const filters = useSelector(filterFactorySelector);
  const savedSearches = useSelector(recentSearchesSelector).filter(({ saved }) => saved);
  const [query, setQuery] = useState<string | undefined>(savedSearches[0]?.query);
  const options: Option[] = savedSearches.map(({ query }) => ({
    key: query,
    content: query,
    onSelected: () => setQuery(query),
  }));

  const filter = useMemo(() => query && filters(query), [filters, query]);
  const items = useMemo(
    () => _.sortBy(filter ? allItems.filter(filter) : allItems, ({ id }) => -id),
    [allItems, filter]
  );

  const dispatch = useDispatch();

  return (
    <CollapsibleTitle
      title={t('ActiveMode.Farming')}
      sectionId={'active-filter'}
      className={styles.collapseTitle}
      defaultCollapsed={true}
    >
      {options.length > 0 && query && (
        <div className={styles.options}>
          <Dropdown options={options}>{t('ActiveMode.ChangeFilter')}</Dropdown>
          <ItemActionsDropdown
            filteredItems={items}
            searchActive={Boolean(query?.length)}
            searchQuery={query}
          />
          <div className={styles.applySearch} onClick={() => dispatch(setSearchQuery(query))}>
            <AppIcon icon={searchIcon} />
          </div>
        </div>
      )}
      <div className={styles.matchedItems}>
        {options.length ? (
          items.map((item) => (
            <ConnectedInventoryItem
              key={item.index}
              id={'farm-' + item.index}
              item={item}
              onClick={() => locateItem(item)}
            />
          ))
        ) : (
          <div className={styles.noSearches}>
            <div className={styles.message}>{t('ActiveMode.NoSearches')}</div>
          </div>
        )}
      </div>
    </CollapsibleTitle>
  );
}
