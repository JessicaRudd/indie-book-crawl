import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { ATLANTA_CENTER, BOOKSTORES, QUICK_START_LOCATIONS } from './data.js';

const USAGE_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

const MAX_ROUTE_STOPS = 26;
const SAVED_ROUTES_STORAGE_KEY = 'atlanta-indie-bookshop-crawl:saved-routes:v1';

const state = {
  map: null,
  infoWindow: null,
  autocompleteEl: null,
  selectedOrigin: {
    label: QUICK_START_LOCATIONS[0].label,
    coords: { ...QUICK_START_LOCATIONS[0].coords },
    isCurrentLocation: false,
  },
  selectedStoreIds: [],
  expandedStoreIds: new Set(),
  filterQuery: '',
  stopOrderByStoreId: {},
  storeMarkers: new Map(),
  originMarker: null,
  routePolylines: [],
  lastRoutePlan: null,
  lastTravelMode: 'DRIVING',
  libs: {},
};

const dom = {
  form: document.getElementById('crawl-form'),
  useMyLocationBtn: document.getElementById('use-my-location-btn'),
  autocompleteContainer: document.getElementById('start-autocomplete-container'),
  quickStartButtons: document.getElementById('quick-start-buttons'),
  originReadout: document.getElementById('selected-origin-readout'),
  departureTime: document.getElementById('departure-time'),
  setNowBtn: document.getElementById('set-now-btn'),
  departureTimeError: document.getElementById('departure-time-error'),
  selectedCount: document.getElementById('selected-count'),
  storeFilter: document.getElementById('store-filter'),
  storeList: document.getElementById('store-list'),
  storeSelectionError: document.getElementById('store-selection-error'),
  selectAllBtn: document.getElementById('select-all-btn'),
  clearStoresBtn: document.getElementById('clear-stores-btn'),
  noticeBanner: document.getElementById('route-notice'),
  generateBtn: document.getElementById('generate-route-btn'),
  resetBtn: document.getElementById('reset-route-btn'),
  itineraryContainer: document.getElementById('itinerary-container'),
  savedRoutesSection: document.getElementById('saved-routes-section'),
  savedRoutesCount: document.getElementById('saved-routes-count'),
  savedRoutesList: document.getElementById('saved-routes-list'),
  mapContainer: document.getElementById('map'),
  storeSelectionLive: document.getElementById('store-selection-live'),
  mapLiveRegion: document.getElementById('map-live-region'),
};

function announceLiveRegion(element, message) {
  if (!element || !message) return;
  element.textContent = '';
  window.requestAnimationFrame(() => {
    element.textContent = message;
  });
}

function announceChecklistStatus(message) {
  announceLiveRegion(dom.storeSelectionLive, message);
}

function announceMapStatus(message) {
  announceLiveRegion(dom.mapLiveRegion, message);
}

function buildMarkerTitle(store, isSelected, stopOrder) {
  if (stopOrder) {
    return `Stop ${stopOrder}: ${store.name} (${store.neighborhood})`;
  }
  if (isSelected) {
    return `${store.name} (${store.neighborhood}) — Selected`;
  }
  return `${store.name} (${store.neighborhood})`;
}

function buildMarkerAriaLabel(store, isSelected, stopOrder) {
  const parts = [];
  if (stopOrder) {
    parts.push(`Stop ${stopOrder}`);
  }
  parts.push(`${store.name} in ${store.neighborhood}`);
  parts.push(isSelected ? 'selected in crawl' : 'not selected');
  parts.push('Press Enter or Space for bookstore details');
  return `${parts.join(', ')}.`;
}

function createBookPinElement(store, isSelected, stopOrder, onActivate) {
  const pin = document.createElement('div');
  pin.className = `book-marker${isSelected ? ' is-selected' : ''}`;
  pin.tabIndex = 0;
  pin.dataset.storeId = store.id;
  pin.setAttribute('role', 'button');
  pin.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  pin.setAttribute('aria-describedby', 'map-live-region');
  pin.setAttribute('aria-label', buildMarkerAriaLabel(store, isSelected, stopOrder));

  pin.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (onActivate) {
        onActivate();
      }
    }
  });

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('width', '14');
  icon.setAttribute('height', '14');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2.2');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M2 4.5A2.5 2.5 0 0 1 4.5 2H12v18H4.5A2.5 2.5 0 0 0 2 22V4.5Zm10-2.5h7.5A2.5 2.5 0 0 1 22 4.5V22a2.5 2.5 0 0 0-2.5-2H12V2Z');
  icon.appendChild(path);
  pin.appendChild(icon);

  if (stopOrder) {
    const orderBadge = document.createElement('span');
    orderBadge.className = 'book-marker-order';
    orderBadge.textContent = String(stopOrder);
    pin.appendChild(orderBadge);
  }

  return pin;
}

function createOriginPinElement(originLabel = state.selectedOrigin.label) {
  const pin = document.createElement('div');
  pin.className = 'origin-marker';
  pin.setAttribute('role', 'img');
  pin.setAttribute('aria-label', `Start location marker: ${originLabel || 'Crawl start'}`);
  pin.textContent = 'Start';
  return pin;
}

function showNotice(message, isError = false) {
  dom.noticeBanner.textContent = message;
  dom.noticeBanner.classList.toggle('is-error', isError);
  dom.noticeBanner.hidden = false;
}

function clearNotice() {
  dom.noticeBanner.textContent = '';
  dom.noticeBanner.classList.remove('is-error');
  dom.noticeBanner.hidden = true;
}

function updateOriginReadout(errorMessage = '') {
  if (!dom.originReadout) return;

  if (errorMessage) {
    dom.originReadout.textContent = errorMessage;
    dom.originReadout.classList.add('is-error');
    return;
  }

  dom.originReadout.classList.remove('is-error');
  if (state.selectedOrigin.isCurrentLocation && state.selectedOrigin.coords) {
    const { lat, lng } = state.selectedOrigin.coords;
    dom.originReadout.textContent = `Starting from: Current location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  } else if (state.selectedOrigin.label) {
    dom.originReadout.textContent = `Starting from: ${state.selectedOrigin.label}`;
  } else {
    dom.originReadout.textContent = '';
  }
}

function setAutocompleteDisplayText(text) {
  if (!state.autocompleteEl) return;
  try {
    state.autocompleteEl.value = text;
  } catch {
    // Ignore if the web component does not accept programmatic string assignment.
  }
}

function updateUseLocationButton() {
  if (!dom.useMyLocationBtn) return;
  dom.useMyLocationBtn.classList.toggle('is-active', Boolean(state.selectedOrigin.isCurrentLocation));
}

function updateOriginMarkerOnMap(panToOrigin = false) {
  if (!state.map || !state.libs.marker || !state.selectedOrigin.coords) return;
  const { AdvancedMarkerElement } = state.libs.marker;

  if (state.originMarker) {
    state.originMarker.map = null;
    state.originMarker = null;
  }

  state.originMarker = new AdvancedMarkerElement({
    map: state.map,
    position: state.selectedOrigin.coords,
    title: `Start: ${state.selectedOrigin.label}`,
  });
  state.originMarker.append(createOriginPinElement(state.selectedOrigin.label));
  announceMapStatus(`Start location marker placed on map at ${state.selectedOrigin.label}.`);

  if (panToOrigin) {
    state.map.panTo(state.selectedOrigin.coords);
    if ((state.map.getZoom() ?? 10) < 12) {
      state.map.setZoom(12);
    }
  }
}

function requestCurrentLocation({ silentIfBlocked = false } = {}) {
  if (!('geolocation' in navigator)) {
    if (!silentIfBlocked) {
      const msg =
        'Location services are not supported by your browser. Search an address or pick a quick-start landmark.';
      updateOriginReadout(msg);
      showNotice(msg, true);
    }
    return;
  }

  const labelEl = dom.useMyLocationBtn?.querySelector('span');
  if (dom.useMyLocationBtn) {
    dom.useMyLocationBtn.disabled = true;
    if (labelEl) labelEl.textContent = 'Locating...';
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coords = {
        lat: Number(position.coords.latitude.toFixed(6)),
        lng: Number(position.coords.longitude.toFixed(6)),
      };
      setAutocompleteDisplayText(
        `My Current Location (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`
      );
      state.selectedOrigin = {
        label: 'My Current Location',
        coords,
        isCurrentLocation: true,
      };
      updateOriginReadout();
      renderQuickStartButtons();
      updateUseLocationButton();
      updateOriginMarkerOnMap(true);
      clearNotice();

      if (dom.useMyLocationBtn) {
        dom.useMyLocationBtn.disabled = false;
        if (labelEl) labelEl.textContent = 'Use My Location';
      }
    },
    (error) => {
      if (dom.useMyLocationBtn) {
        dom.useMyLocationBtn.disabled = false;
        if (labelEl) labelEl.textContent = 'Use My Location';
      }
      if (silentIfBlocked) return;

      const rawMsg = (error?.message || '').toLowerCase();
      let msg;
      if (rawMsg.includes('permissions policy') || rawMsg.includes('feature policy')) {
        msg =
          'Location access is blocked inside this embedded frame. Open the app directly in a new tab or enter an address below.';
      } else if (error.code === error.PERMISSION_DENIED) {
        msg =
          'Location access was denied. Allow location access in your browser site settings, search an address, or pick a quick-start landmark.';
      } else if (error.code === error.TIMEOUT) {
        msg =
          'Location request timed out. Please try again, search an address, or pick a quick-start landmark.';
      } else {
        msg =
          'Unable to retrieve your current location right now. Please search an address or choose a quick-start landmark.';
      }

      updateOriginReadout(msg);
      showNotice(msg, true);
    },
    {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 120000,
    }
  );
}

function renderQuickStartButtons() {
  const fragment = document.createDocumentFragment();
  QUICK_START_LOCATIONS.forEach((loc) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-pick-btn';
    if (!state.selectedOrigin.isCurrentLocation && state.selectedOrigin.label === loc.label) {
      btn.classList.add('is-active');
    }
    btn.textContent = loc.shortLabel;
    btn.addEventListener('click', () => {
      setAutocompleteDisplayText(loc.label);
      state.selectedOrigin = {
        label: loc.label,
        coords: { ...loc.coords },
        isCurrentLocation: false,
      };
      updateOriginReadout();
      renderQuickStartButtons();
      updateUseLocationButton();
      clearNotice();
    });
    fragment.appendChild(btn);
  });
  dom.quickStartButtons.replaceChildren(fragment);
}

function buildStoreSearchText(store) {
  return [
    store.name,
    store.neighborhood,
    store.address,
    store.instagram,
    store.hours,
    store.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function storeMatchesTerms(searchText, rawQuery) {
  const terms = String(rawQuery || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return true;
  return terms.every((term) => searchText.includes(term));
}

function getFilteredStores() {
  if (!state.filterQuery.trim()) return BOOKSTORES;
  return BOOKSTORES.filter((store) =>
    storeMatchesTerms(buildStoreSearchText(store), state.filterQuery)
  );
}

function filterStoreList() {
  if (!dom.storeList) return 0;
  const rawQuery = dom.storeFilter?.value ?? state.filterQuery;
  state.filterQuery = rawQuery;

  const items = dom.storeList.querySelectorAll('.store-item');
  let visibleCount = 0;

  items.forEach((item) => {
    const searchText = item.dataset.search || '';
    const matches = storeMatchesTerms(searchText, rawQuery);
    item.hidden = !matches;
    if (matches) visibleCount += 1;
  });

  const emptyRow = dom.storeList.querySelector('.store-empty-row');
  if (emptyRow) {
    emptyRow.hidden = visibleCount > 0;
  }

  return visibleCount;
}

function getActiveStoreControlState() {
  const activeEl = document.activeElement;
  if (!activeEl || !dom.storeList || !dom.storeList.contains(activeEl)) {
    return null;
  }
  const activeItem = activeEl.closest('.store-item');
  if (!activeItem?.dataset.storeId) return null;
  let controlSelector = '.store-checkbox';
  if (activeEl.classList.contains('store-details-btn')) {
    controlSelector = '.store-details-btn';
  } else if (activeEl.classList.contains('store-focus-btn')) {
    controlSelector = '.store-focus-btn';
  }
  return {
    storeId: activeItem.dataset.storeId,
    controlSelector,
  };
}

function buildInstagramUrl(handle) {
  const username = String(handle || '').replace(/^@+/, '').trim();
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

function createInstagramLink(store, text, className) {
  const link = document.createElement('a');
  link.href = buildInstagramUrl(store.instagram);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = className;
  link.textContent = text;
  link.setAttribute('aria-label', `${store.name} on Instagram (${store.instagram})`);
  return link;
}

function createDetailLine(labelText, valueText) {
  const line = document.createElement('p');
  line.className = 'store-extra-line';
  const label = document.createElement('span');
  label.className = 'store-extra-label';
  label.textContent = `${labelText}: `;
  const value = document.createElement('span');
  value.textContent = valueText;
  line.appendChild(label);
  line.appendChild(value);
  return line;
}

function renderStoreList() {
  if (dom.selectedCount) {
    dom.selectedCount.textContent = String(state.selectedStoreIds.length);
  }

  const activeControl = getActiveStoreControlState();
  const fragment = document.createDocumentFragment();

  BOOKSTORES.forEach((store) => {
    const isSelected = state.selectedStoreIds.includes(store.id);
    const isExpanded = state.expandedStoreIds.has(store.id);
    const stopOrder = state.stopOrderByStoreId[store.id];

    const li = document.createElement('li');
    li.className = 'store-item';
    li.dataset.storeId = store.id;
    li.dataset.search = buildStoreSearchText(store);

    const row = document.createElement('div');
    row.className = `store-row${isSelected ? ' is-selected' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `store-${store.id}`;
    checkbox.className = 'store-checkbox';
    checkbox.checked = isSelected;
    checkbox.setAttribute(
      'aria-label',
      `${store.name}, ${store.neighborhood}${stopOrder ? `, Stop ${stopOrder}` : ''}`
    );
    checkbox.addEventListener('change', () => toggleStoreSelection(store.id, checkbox.checked));

    const details = document.createElement('div');
    details.className = 'store-details';

    const titleRow = document.createElement('div');
    titleRow.className = 'store-title-row';

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.className = 'store-name';
    label.textContent = store.name;
    titleRow.appendChild(label);

    if (stopOrder) {
      const orderLabel = document.createElement('span');
      orderLabel.className = 'store-stop-order';
      orderLabel.textContent = `Stop ${stopOrder}`;
      titleRow.appendChild(orderLabel);
    }

    const meta = document.createElement('div');
    meta.className = 'store-meta';
    if (store.neighborhood) {
      meta.appendChild(document.createTextNode(store.neighborhood));
    }
    if (store.neighborhood && store.instagram) {
      meta.appendChild(document.createTextNode(' · '));
    }
    if (store.instagram) {
      meta.appendChild(createInstagramLink(store, store.instagram, 'store-ig-link'));
    }

    details.appendChild(titleRow);
    details.appendChild(meta);

    const detailsPanelId = `store-details-${store.id}`;
    const detailsPanel = document.createElement('div');
    detailsPanel.id = detailsPanelId;
    detailsPanel.className = 'store-extra-details';
    detailsPanel.hidden = !isExpanded;

    if (store.hours) {
      detailsPanel.appendChild(createDetailLine('Hours', store.hours));
    }
    detailsPanel.appendChild(createDetailLine('Address', store.address));

    if (store.description) {
      const desc = document.createElement('p');
      desc.className = 'store-extra-description';
      desc.textContent = store.description;
      detailsPanel.appendChild(desc);
    }

    if (store.website) {
      const siteLink = document.createElement('a');
      siteLink.href = store.website;
      siteLink.target = '_blank';
      siteLink.rel = 'noopener noreferrer';
      siteLink.className = 'store-extra-link';
      siteLink.textContent = 'Visit bookstore website';
      detailsPanel.appendChild(siteLink);
    }

    const actions = document.createElement('div');
    actions.className = 'store-item-actions';

    const detailsBtn = document.createElement('button');
    detailsBtn.type = 'button';
    detailsBtn.className = `store-details-btn${isExpanded ? ' is-expanded' : ''}`;
    detailsBtn.textContent = isExpanded ? 'Hide Details' : 'Show Details';
    detailsBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    detailsBtn.setAttribute('aria-controls', detailsPanelId);
    detailsBtn.setAttribute(
      'aria-label',
      `${isExpanded ? 'Hide' : 'Show'} details for ${store.name}`
    );
    detailsBtn.addEventListener('click', () => {
      const nextExpanded = !state.expandedStoreIds.has(store.id);
      if (nextExpanded) {
        state.expandedStoreIds.add(store.id);
      } else {
        state.expandedStoreIds.delete(store.id);
      }
      detailsPanel.hidden = !nextExpanded;
      detailsBtn.classList.toggle('is-expanded', nextExpanded);
      detailsBtn.textContent = nextExpanded ? 'Hide Details' : 'Show Details';
      detailsBtn.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
      detailsBtn.setAttribute(
        'aria-label',
        `${nextExpanded ? 'Hide' : 'Show'} details for ${store.name}`
      );
      announceChecklistStatus(
        `${nextExpanded ? 'Expanded' : 'Collapsed'} details for ${store.name}.`
      );
    });

    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'store-focus-btn';
    focusBtn.textContent = 'View';
    focusBtn.setAttribute('aria-label', `Center map on ${store.name}`);
    focusBtn.addEventListener('click', () => focusStoreOnMap(store));

    actions.appendChild(detailsBtn);
    actions.appendChild(focusBtn);

    row.appendChild(checkbox);
    row.appendChild(details);
    row.appendChild(actions);
    li.appendChild(row);
    li.appendChild(detailsPanel);
    fragment.appendChild(li);
  });

  const emptyLi = document.createElement('li');
  emptyLi.className = 'store-empty-row';
  emptyLi.textContent = 'No participating shops match your filter.';
  emptyLi.hidden = true;
  fragment.appendChild(emptyLi);

  dom.storeList.replaceChildren(fragment);
  filterStoreList();

  if (activeControl) {
    const targetRow = dom.storeList.querySelector(
      `.store-item[data-store-id="${activeControl.storeId}"]:not([hidden])`
    );
    const targetEl = targetRow?.querySelector(activeControl.controlSelector);
    if (targetEl) {
      targetEl.focus({ preventScroll: true });
    }
  }
}

function refreshMarkers() {
  const activeMarkerStoreId = document.activeElement?.classList?.contains('book-marker')
    ? document.activeElement.dataset.storeId
    : null;

  BOOKSTORES.forEach((store) => {
    const marker = state.storeMarkers.get(store.id);
    if (!marker) return;
    const isSelected = state.selectedStoreIds.includes(store.id);
    const stopOrder = state.stopOrderByStoreId[store.id];
    marker.title = buildMarkerTitle(store, isSelected, stopOrder);
    const pin = createBookPinElement(store, isSelected, stopOrder, () =>
      openStoreInfoWindow(store, { pan: true })
    );
    marker.replaceChildren(pin);
    if (activeMarkerStoreId === store.id) {
      pin.focus({ preventScroll: true });
    }
  });
}

function toggleStoreSelection(storeId, shouldInclude) {
  if (shouldInclude && !state.selectedStoreIds.includes(storeId)) {
    state.selectedStoreIds.push(storeId);
  } else if (!shouldInclude) {
    state.selectedStoreIds = state.selectedStoreIds.filter((id) => id !== storeId);
  }
  state.stopOrderByStoreId = {};
  if (state.selectedStoreIds.length > 0) {
    setStoreSelectionError('');
  }
  renderStoreList();
  refreshMarkers();

  const store = BOOKSTORES.find((entry) => entry.id === storeId);
  if (store) {
    const actionLabel = shouldInclude ? 'added to' : 'removed from';
    const message = `${store.name} ${actionLabel} crawl. ${state.selectedStoreIds.length} of ${BOOKSTORES.length} bookshops selected.`;
    announceChecklistStatus(message);
    announceMapStatus(`Map marker updated: ${message}`);
  }
}

function buildInfoWindowContent(store) {
  const isSelected = state.selectedStoreIds.includes(store.id);

  const card = document.createElement('div');
  card.className = 'info-window-card';

  const title = document.createElement('h3');
  title.className = 'info-window-title';
  title.textContent = store.name;

  const meta = document.createElement('p');
  meta.className = 'info-window-meta';
  meta.textContent = store.neighborhood;

  const address = document.createElement('p');
  address.className = 'info-window-address';
  address.textContent = store.address;

  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(address);

  if (store.website || store.instagram) {
    const links = document.createElement('p');
    links.className = 'info-window-links';
    if (store.website) {
      const siteLink = document.createElement('a');
      siteLink.href = store.website;
      siteLink.target = '_blank';
      siteLink.rel = 'noopener noreferrer';
      siteLink.className = 'info-window-link';
      siteLink.textContent = 'Website';
      links.appendChild(siteLink);
    }
    if (store.website && store.instagram) {
      const sep = document.createElement('span');
      sep.textContent = ' · ';
      links.appendChild(sep);
    }
    if (store.instagram) {
      links.appendChild(createInstagramLink(store, `IG ${store.instagram}`, 'info-window-link'));
    }
    card.appendChild(links);
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = `info-window-btn${isSelected ? ' is-included' : ''}`;
  toggleBtn.textContent = isSelected ? 'Remove from Crawl' : 'Add to Crawl';
  toggleBtn.addEventListener('click', () => {
    toggleStoreSelection(store.id, !isSelected);
    const updatedCard = buildInfoWindowContent(store);
    state.infoWindow.setContent(updatedCard);
    updatedCard.querySelector('.info-window-btn')?.focus();
  });

  card.appendChild(toggleBtn);
  return card;
}

function openStoreInfoWindow(store, { pan = false } = {}) {
  if (!state.map || !state.infoWindow) return;
  const marker = state.storeMarkers.get(store.id);
  if (pan) {
    state.map.panTo(store.coords);
    if ((state.map.getZoom() ?? 12) < 13) {
      state.map.setZoom(14);
    }
  }
  if (marker) {
    state.infoWindow.setContent(buildInfoWindowContent(store));
    state.infoWindow.open({ anchor: marker, map: state.map });
  }

  const isSelected = state.selectedStoreIds.includes(store.id);
  const stopOrder = state.stopOrderByStoreId[store.id];
  const stopPhrase = stopOrder ? ` Stop ${stopOrder} on route.` : '';
  const selectionPhrase = isSelected ? ' Included in crawl.' : ' Not selected.';
  announceMapStatus(
    `Map focused on ${store.name}, ${store.neighborhood}, ${store.address}.${stopPhrase}${selectionPhrase}`
  );
}

function focusStoreOnMap(store) {
  openStoreInfoWindow(store, { pan: true });
}

function renderStoreMarkers() {
  const { AdvancedMarkerElement } = state.libs.marker;

  BOOKSTORES.forEach((store) => {
    const isSelected = state.selectedStoreIds.includes(store.id);
    const marker = new AdvancedMarkerElement({
      map: state.map,
      position: store.coords,
      title: buildMarkerTitle(store, isSelected, null),
    });
    marker.append(
      createBookPinElement(store, isSelected, null, () =>
        openStoreInfoWindow(store, { pan: true })
      )
    );

    // Standard 'click' on AdvancedMarkerElement works across all API channels including weekly.
    marker.addListener('click', () => {
      openStoreInfoWindow(store);
    });

    state.storeMarkers.set(store.id, marker);
  });

  announceMapStatus(
    `Map ready with ${BOOKSTORES.length} independent bookstore markers across Atlanta and Decatur.`
  );
}

function initAutocomplete() {
  const { PlaceAutocompleteElement } = state.libs.places;
  const autocomplete = new PlaceAutocompleteElement({
    includedRegionCodes: ['us'],
    locationBias: { radius: 35000, center: ATLANTA_CENTER },
    placeholder: 'Search Atlanta starting address...',
  });
  autocomplete.setAttribute('aria-labelledby', 'start-location-label');
  autocomplete.value = state.selectedOrigin.label;

  autocomplete.addEventListener('input', () => {
    state.selectedOrigin = {
      label: autocomplete.value.trim(),
      coords: null,
      isCurrentLocation: false,
    };
    updateOriginReadout();
    renderQuickStartButtons();
    updateUseLocationButton();
  });

  autocomplete.addEventListener('gmp-select', async ({ placePrediction }) => {
    if (!placePrediction) return;
    const place = placePrediction.toPlace();
    await place.fetchFields({
      fields: ['location', 'formattedAddress', 'displayName'],
    });

    if (place.location) {
      const label = place.formattedAddress || place.displayName || autocomplete.value;
      state.selectedOrigin = {
        label,
        coords: place.location.toJSON(),
        isCurrentLocation: false,
      };
      updateOriginReadout();
      renderQuickStartButtons();
      updateUseLocationButton();
      clearNotice();
    }
  });

  state.autocompleteEl = autocomplete;
  dom.autocompleteContainer.appendChild(autocomplete);
  updateOriginReadout();
  renderQuickStartButtons();
  updateUseLocationButton();
}

function clearRouteOverlays() {
  state.routePolylines.forEach((polyline) => polyline.setMap(null));
  state.routePolylines = [];

  if (state.originMarker) {
    state.originMarker.map = null;
    state.originMarker = null;
  }

  state.stopOrderByStoreId = {};
  renderStoreList();
  refreshMarkers();
}

function formatDurationMs(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

function formatMiles(meters) {
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

function getSelectedTravelMode() {
  const checked = dom.form.querySelector('input[name="travelMode"]:checked');
  return checked ? checked.value : 'DRIVING';
}

function formatLocalDateTimeInput(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setDepartureTimeError(message) {
  const hasError = Boolean(message);
  if (dom.departureTime) {
    dom.departureTime.classList.toggle('is-invalid', hasError);
    dom.departureTime.setAttribute('aria-invalid', hasError ? 'true' : 'false');
  }
  if (dom.departureTimeError) {
    dom.departureTimeError.textContent = message;
    dom.departureTimeError.hidden = !hasError;
  }
}

function setStoreSelectionError(message) {
  const hasError = Boolean(message);
  if (dom.storeList) {
    dom.storeList.classList.toggle('is-invalid', hasError);
    dom.storeList.setAttribute('aria-invalid', hasError ? 'true' : 'false');
  }
  if (dom.storeSelectionError) {
    dom.storeSelectionError.textContent = message;
    dom.storeSelectionError.hidden = !hasError;
  }
}

function clearValidationErrors() {
  setDepartureTimeError('');
  setStoreSelectionError('');
}

function validateDepartureDate(travelMode) {
  const raw = dom.departureTime?.value?.trim() || '';
  if (!raw) {
    return {
      valid: false,
      date: null,
      message: 'Please select a departure date and time before generating a route.',
    };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return {
      valid: false,
      date: null,
      message: 'Please enter a valid departure date and time.',
    };
  }

  const nowMs = Date.now();
  if (travelMode === 'DRIVING') {
    const fiveMinutesMs = 5 * 60 * 1000;
    if (parsed.getTime() < nowMs - fiveMinutesMs) {
      return {
        valid: false,
        date: null,
        message: 'For Drive mode, choose a current or future departure time.',
      };
    }
    return {
      valid: true,
      date: new Date(Math.max(parsed.getTime(), nowMs + 60 * 1000)),
      message: '',
    };
  }

  if (travelMode === 'TRANSIT') {
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const hundredDaysMs = 100 * 24 * 60 * 60 * 1000;
    if (parsed.getTime() < nowMs - sevenDaysMs || parsed.getTime() > nowMs + hundredDaysMs) {
      return {
        valid: false,
        date: null,
        message: 'Transit schedules are available from 7 days ago up to 100 days ahead.',
      };
    }
  }

  return { valid: true, date: parsed, message: '' };
}

function validateCrawlForm() {
  clearValidationErrors();

  const storeById = new Map(BOOKSTORES.map((store) => [store.id, store]));
  const selectedStores = state.selectedStoreIds.map((id) => storeById.get(id)).filter(Boolean);
  const originText = state.selectedOrigin.label || state.autocompleteEl?.value?.trim() || '';
  const travelMode = getSelectedTravelMode();
  const departureValidation = validateDepartureDate(travelMode);

  const errors = [];
  let firstInvalidFocusTarget = null;

  if (!originText && !state.selectedOrigin.coords) {
    errors.push('Enter or choose a starting location in Atlanta.');
    firstInvalidFocusTarget ||= state.autocompleteEl;
  }

  if (!departureValidation.valid) {
    setDepartureTimeError(departureValidation.message);
    errors.push(departureValidation.message);
    firstInvalidFocusTarget ||= dom.departureTime;
  }

  if (selectedStores.length === 0) {
    const msg = 'Select at least one independent bookstore to plan your crawl.';
    setStoreSelectionError(msg);
    errors.push(msg);
    firstInvalidFocusTarget ||= dom.storeList?.querySelector('.store-checkbox') || dom.storeFilter;
  } else if (travelMode !== 'TRANSIT' && selectedStores.length > MAX_ROUTE_STOPS) {
    const msg = `Google Routes supports up to ${MAX_ROUTE_STOPS} bookshop stops per route. Please uncheck ${selectedStores.length - MAX_ROUTE_STOPS} shop(s) or plan in regional segments.`;
    setStoreSelectionError(msg);
    errors.push(msg);
    firstInvalidFocusTarget ||= dom.storeList?.querySelector('.store-checkbox') || dom.storeFilter;
  }

  if (errors.length > 0) {
    showNotice(errors.join(' '), true);
    firstInvalidFocusTarget?.focus?.();
    return { valid: false };
  }

  return {
    valid: true,
    selectedStores,
    originInput: state.selectedOrigin.coords || originText,
    travelMode,
    departureDate: departureValidation.date,
  };
}

async function computeOptimizedRoute(originInput, selectedStores, travelMode, departureDate) {
  const { Route, TrafficModel, RoutingPreference, TravelMode } = state.libs.routes;
  const lastStore = selectedStores[selectedStores.length - 1];
  const intermediateStores = selectedStores.slice(0, -1);

  const request = {
    origin: originInput,
    destination: lastStore.coords,
    travelMode: TravelMode?.[travelMode] ?? travelMode,
    fields: [
      'path',
      'legs',
      'viewport',
      'durationMillis',
      'distanceMeters',
      'localizedValues',
      'optimizedIntermediateWaypointIndices',
    ],
    internalUsageAttributionIds: [USAGE_ATTRIBUTION_ID],
  };

  if (intermediateStores.length > 0) {
    request.intermediates = intermediateStores.map((store) => ({ location: store.coords }));
    request.optimizeWaypointOrder = true;
  }

  if (travelMode === 'DRIVING') {
    if (departureDate) {
      request.departureTime = departureDate;
    }
    // Routes API forbids TRAFFIC_AWARE_OPTIMAL (and trafficModel) when optimizeWaypointOrder is true.
    if (departureDate && intermediateStores.length === 0) {
      request.routingPreference =
        RoutingPreference?.TRAFFIC_AWARE_OPTIMAL ?? 'TRAFFIC_AWARE_OPTIMAL';
      request.trafficModel = TrafficModel?.BEST_GUESS ?? 'bestguess';
    } else {
      request.routingPreference = RoutingPreference?.TRAFFIC_AWARE ?? 'TRAFFIC_AWARE';
    }
  } else if (travelMode === 'TRANSIT' && departureDate) {
    request.departureTime = departureDate;
  }

  const { routes } = await Route.computeRoutes(request);
  if (!routes || routes.length === 0) {
    throw new Error('No route found between the selected locations.');
  }

  const route = routes[0];
  let orderedStores = [...selectedStores];

  if (
    intermediateStores.length > 0 &&
    Array.isArray(route.optimizedIntermediateWaypointIndices) &&
    route.optimizedIntermediateWaypointIndices.length === intermediateStores.length
  ) {
    const reorderedIntermediates = route.optimizedIntermediateWaypointIndices.map(
      (idx) => intermediateStores[idx]
    );
    orderedStores = [...reorderedIntermediates, lastStore];
  }

  const legs = (route.legs || []).map((leg, idx) => ({
    fromLabel: idx === 0 ? state.selectedOrigin.label : orderedStores[idx - 1].name,
    toLabel: orderedStores[idx]?.name || `Stop ${idx + 1}`,
    leg,
    routeForPolyline: idx === 0 ? route : null,
  }));

  return {
    orderedStores,
    routes: [route],
    legs,
    totalDurationMs: route.durationMillis ?? 0,
    totalDistanceMeters: route.distanceMeters ?? 0,
  };
}

// Routes API TRANSIT does not optimize or accept intermediate waypoints, so multi-stop
// MARTA trips are computed chronologically leg-by-leg in the user's selected order.
async function computeChronologicalTransitRoute(originInput, selectedStores, departureDate) {
  const { Route, TravelMode } = state.libs.routes;
  const routes = [];
  const legs = [];
  let totalDurationMs = 0;
  let totalDistanceMeters = 0;
  let cursorTimeMs = departureDate ? departureDate.getTime() : Date.now();

  for (let i = 0; i < selectedStores.length; i += 1) {
    const legOrigin = i === 0 ? originInput : selectedStores[i - 1].coords;
    const legDestination = selectedStores[i].coords;

    const request = {
      origin: legOrigin,
      destination: legDestination,
      travelMode: TravelMode?.TRANSIT ?? 'TRANSIT',
      departureTime: new Date(cursorTimeMs),
      fields: ['path', 'legs', 'viewport', 'durationMillis', 'distanceMeters', 'localizedValues'],
      internalUsageAttributionIds: [USAGE_ATTRIBUTION_ID],
    };

    const { routes: legRoutes } = await Route.computeRoutes(request);
    if (!legRoutes || legRoutes.length === 0) {
      throw new Error(
        `No MARTA / transit route found reaching ${selectedStores[i].name} at that time.`
      );
    }

    const legRoute = legRoutes[0];
    const legDuration = legRoute.durationMillis ?? 0;
    const legDistance = legRoute.distanceMeters ?? 0;

    routes.push(legRoute);
    totalDurationMs += legDuration;
    totalDistanceMeters += legDistance;
    cursorTimeMs += legDuration;

    const primaryLeg = legRoute.legs?.[0];
    if (primaryLeg) {
      legs.push({
        fromLabel: i === 0 ? state.selectedOrigin.label : selectedStores[i - 1].name,
        toLabel: selectedStores[i].name,
        leg: primaryLeg,
      });
    }
  }

  return {
    orderedStores: [...selectedStores],
    routes,
    legs,
    totalDurationMs,
    totalDistanceMeters,
  };
}

function buildStepInstructionText(step) {
  if (step.transitDetails) {
    const line = step.transitDetails.transitLine;
    const lineName = line?.shortName || line?.name || 'Transit';
    const agencyName = line?.agencies?.[0]?.name;
    const departureStop = step.transitDetails.departureStop?.name;
    const arrivalStop = step.transitDetails.arrivalStop?.name;
    const stopCount = step.transitDetails.stopCount;
    const stopSuffix = stopCount ? ` (${stopCount} stops)` : '';
    const agencyPrefix = agencyName && !lineName.includes(agencyName) ? `${agencyName} ` : '';
    if (departureStop && arrivalStop) {
      return `Board ${agencyPrefix}${lineName} at ${departureStop} toward ${arrivalStop}${stopSuffix}`;
    }
  }
  return step.instructions || 'Continue along route';
}

function renderRoute(routePlan, travelMode) {
  const { AdvancedMarkerElement } = state.libs.marker;
  const { LatLngBounds } = state.libs.core;

  const polylineColor = travelMode === 'BICYCLING' ? '#4A6B53' : '#C2592B';

  routePlan.routes.forEach((route) => {
    const polylines = route.createPolylines({
      polylineOptions:
        travelMode === 'TRANSIT'
          ? undefined
          : {
              strokeColor: polylineColor,
              strokeOpacity: 0.9,
              strokeWeight: 5,
            },
    });
    polylines.forEach((polyline) => {
      polyline.setMap(state.map);
      state.routePolylines.push(polyline);
    });
  });

  if (state.selectedOrigin.coords) {
    state.originMarker = new AdvancedMarkerElement({
      map: state.map,
      position: state.selectedOrigin.coords,
      title: `Start: ${state.selectedOrigin.label}`,
    });
    state.originMarker.append(createOriginPinElement(state.selectedOrigin.label));
  }

  const orderMap = {};
  routePlan.orderedStores.forEach((store, idx) => {
    orderMap[store.id] = idx + 1;
  });
  state.stopOrderByStoreId = orderMap;
  renderStoreList();
  refreshMarkers();

  const bounds = new LatLngBounds();
  if (state.selectedOrigin.coords) {
    bounds.extend(state.selectedOrigin.coords);
  }
  routePlan.orderedStores.forEach((store) => bounds.extend(store.coords));
  routePlan.routes.forEach((route) => {
    if (route.viewport) {
      bounds.union(route.viewport);
    }
  });
  state.map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });

  state.lastRoutePlan = routePlan;
  state.lastTravelMode = travelMode;
  renderItinerary(routePlan, travelMode);
  dom.resetBtn.hidden = false;

  const stopCount = routePlan.orderedStores.length;
  announceMapStatus(
    `Route mapped across ${stopCount} ${stopCount === 1 ? 'stop' : 'stops'}: ${formatDurationMs(
      routePlan.totalDurationMs
    )}, ${formatMiles(routePlan.totalDistanceMeters)}. Numbered map markers 1 through ${stopCount} updated.`
  );
}

function readSavedRoutes() {
  try {
    const raw = window.localStorage.getItem(SAVED_ROUTES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedRoutes(routes) {
  try {
    window.localStorage.setItem(SAVED_ROUTES_STORAGE_KEY, JSON.stringify(routes));
    return true;
  } catch {
    return false;
  }
}

function getDefaultCrawlName(orderedStores) {
  const firstArea = orderedStores[0]?.neighborhood?.split('·')[0]?.trim() || 'Atlanta';
  const count = orderedStores.length;
  return `${firstArea} Crawl (${count} ${count === 1 ? 'stop' : 'stops'})`;
}

function buildShareableRouteUrl(orderedStoreIds, travelMode) {
  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('stops', orderedStoreIds.join(','));
  url.searchParams.set('mode', travelMode);
  if (state.selectedOrigin.label) {
    url.searchParams.set('origin', state.selectedOrigin.label);
  }
  if (state.selectedOrigin.coords) {
    url.searchParams.set('lat', state.selectedOrigin.coords.lat.toFixed(6));
    url.searchParams.set('lng', state.selectedOrigin.coords.lng.toFixed(6));
  }
  if (dom.departureTime.value) {
    url.searchParams.set('time', dom.departureTime.value);
  }
  return url.toString();
}

function buildGoogleMapsDirectionsUrl(orderedStores, travelMode) {
  const modeParamMap = {
    DRIVING: 'driving',
    TRANSIT: 'transit',
    BICYCLING: 'bicycling',
  };
  const params = new URLSearchParams({
    api: '1',
    travelmode: modeParamMap[travelMode] || 'driving',
  });

  if (state.selectedOrigin.coords) {
    params.set('origin', `${state.selectedOrigin.coords.lat},${state.selectedOrigin.coords.lng}`);
  } else if (state.selectedOrigin.label) {
    params.set('origin', state.selectedOrigin.label);
  }

  const destination = orderedStores[orderedStores.length - 1];
  if (destination) {
    params.set('destination', destination.address || `${destination.coords.lat},${destination.coords.lng}`);
  }

  const intermediates = orderedStores.slice(0, -1).slice(0, 9);
  if (intermediates.length > 0) {
    params.set(
      'waypoints',
      intermediates.map((store) => store.address || `${store.coords.lat},${store.coords.lng}`).join('|')
    );
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function buildItineraryTextDocument(routePlan, travelMode) {
  const modeLabels = {
    DRIVING: 'Drive',
    TRANSIT: 'MARTA / Transit',
    BICYCLING: 'Bike',
  };
  const lines = [
    'ATLANTA INDIE BOOKSHOP CRAWL — ROUTE ITINERARY',
    '================================================',
    `Travel Mode: ${modeLabels[travelMode] || travelMode}`,
    `Start Location: ${state.selectedOrigin.label || 'Custom start'}`,
  ];

  if (dom.departureTime.value) {
    lines.push(`Departure Time: ${new Date(dom.departureTime.value).toLocaleString()}`);
  }

  lines.push(
    `Total Travel Time: ${formatDurationMs(routePlan.totalDurationMs)}`,
    `Total Distance: ${formatMiles(routePlan.totalDistanceMeters)}`,
    '',
    'STOP SEQUENCE',
    '-------------',
    `S. ${state.selectedOrigin.label || 'Start'}`
  );

  routePlan.orderedStores.forEach((store, idx) => {
    lines.push(`${idx + 1}. ${store.name} (${store.neighborhood})`);
    lines.push(`   ${store.address}`);
    if (store.website || store.instagram) {
      lines.push(`   ${[store.website, store.instagram ? `IG ${store.instagram}` : ''].filter(Boolean).join(' · ')}`);
    }
  });

  lines.push('', 'TURN-BY-TURN DIRECTIONS', '-----------------------');

  routePlan.legs.forEach((entry, idx) => {
    const dur = entry.leg.localizedValues?.duration || formatDurationMs(entry.leg.durationMillis ?? 0);
    const dist = entry.leg.localizedValues?.distance || formatMiles(entry.leg.distanceMeters ?? 0);
    lines.push('', `Leg ${idx + 1}: ${entry.fromLabel} -> ${entry.toLabel} (${dur}, ${dist})`);
    if (entry.leg.steps && entry.leg.steps.length > 0) {
      entry.leg.steps.forEach((step, stepIdx) => {
        const stepDist = step.localizedValues?.distance;
        const stepDur = step.localizedValues?.staticDuration;
        const meta = [stepDist, stepDur].filter(Boolean).join(' · ');
        lines.push(`  ${stepIdx + 1}. ${buildStepInstructionText(step)}${meta ? ` (${meta})` : ''}`);
      });
    }
  });

  lines.push(
    '',
    `Share Link: ${buildShareableRouteUrl(routePlan.orderedStores.map((s) => s.id), travelMode)}`
  );

  return lines.join('\n');
}

function downloadItineraryText(routePlan, travelMode) {
  const text = buildItineraryTextDocument(routePlan, travelMode);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = 'atlanta-bookshop-crawl-itinerary.txt';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback in restricted iframes.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function renderSavedRoutes() {
  if (!dom.savedRoutesSection || !dom.savedRoutesList || !dom.savedRoutesCount) return;

  const savedRoutes = readSavedRoutes();
  if (savedRoutes.length === 0) {
    dom.savedRoutesSection.hidden = true;
    dom.savedRoutesList.replaceChildren();
    return;
  }

  dom.savedRoutesSection.hidden = false;
  dom.savedRoutesCount.textContent = `${savedRoutes.length} saved`;

  const modeLabels = {
    DRIVING: 'Drive',
    TRANSIT: 'MARTA / Transit',
    BICYCLING: 'Bike',
  };
  const fragment = document.createDocumentFragment();

  savedRoutes.forEach((saved) => {
    const li = document.createElement('li');
    li.className = 'saved-route-card';

    const topRow = document.createElement('div');
    topRow.className = 'saved-route-top';

    const nameEl = document.createElement('h3');
    nameEl.className = 'saved-route-name';
    nameEl.textContent = saved.name;

    topRow.appendChild(nameEl);

    const metaEl = document.createElement('div');
    metaEl.className = 'saved-route-meta';
    const parts = [
      `${saved.storeIds.length} ${saved.storeIds.length === 1 ? 'stop' : 'stops'}`,
      modeLabels[saved.travelMode] || saved.travelMode,
      saved.totalDurationText,
      saved.totalDistanceText,
    ].filter(Boolean);
    metaEl.textContent = parts.join(' · ');

    const originMeta = document.createElement('div');
    originMeta.className = 'saved-route-meta';
    originMeta.textContent = `From: ${saved.origin?.label || 'Custom start'}`;

    const actionsRow = document.createElement('div');
    actionsRow.className = 'saved-route-actions';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.className = 'itinerary-action-btn is-primary-action';
    loadBtn.textContent = 'Load Route';
    loadBtn.addEventListener('click', () => loadSavedRoute(saved));

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'itinerary-action-btn';
    copyBtn.textContent = 'Copy Link';
    copyBtn.addEventListener('click', async () => {
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('stops', saved.storeIds.join(','));
      url.searchParams.set('mode', saved.travelMode || 'DRIVING');
      if (saved.origin?.label) url.searchParams.set('origin', saved.origin.label);
      if (saved.origin?.coords) {
        url.searchParams.set('lat', Number(saved.origin.coords.lat).toFixed(6));
        url.searchParams.set('lng', Number(saved.origin.coords.lng).toFixed(6));
      }
      if (saved.departureTime) url.searchParams.set('time', saved.departureTime);
      const copied = await copyTextToClipboard(url.toString());
      copyBtn.textContent = copied ? 'Copied!' : 'Copy Link';
      window.setTimeout(() => {
        copyBtn.textContent = 'Copy Link';
      }, 2000);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'itinerary-action-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      const remaining = readSavedRoutes().filter((entry) => entry.id !== saved.id);
      writeSavedRoutes(remaining);
      renderSavedRoutes();
    });

    actionsRow.appendChild(loadBtn);
    actionsRow.appendChild(copyBtn);
    actionsRow.appendChild(deleteBtn);

    li.appendChild(topRow);
    li.appendChild(metaEl);
    li.appendChild(originMeta);
    li.appendChild(actionsRow);
    fragment.appendChild(li);
  });

  dom.savedRoutesList.replaceChildren(fragment);
}

function saveCurrentRoute(customName, routePlan, travelMode) {
  const orderedIds = routePlan.orderedStores.map((store) => store.id);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: customName.trim() || getDefaultCrawlName(routePlan.orderedStores),
    savedAt: new Date().toISOString(),
    origin: {
      label: state.selectedOrigin.label,
      coords: state.selectedOrigin.coords ? { ...state.selectedOrigin.coords } : null,
      isCurrentLocation: Boolean(state.selectedOrigin.isCurrentLocation),
    },
    travelMode,
    departureTime: dom.departureTime.value || '',
    storeIds: orderedIds,
    totalDurationText: formatDurationMs(routePlan.totalDurationMs),
    totalDistanceText: formatMiles(routePlan.totalDistanceMeters),
  };

  const existing = readSavedRoutes();
  const next = [entry, ...existing].slice(0, 20);
  const ok = writeSavedRoutes(next);
  renderSavedRoutes();
  return ok;
}

function setSelectedTravelMode(travelMode) {
  const target = dom.form.querySelector(`input[name="travelMode"][value="${travelMode}"]`);
  if (target) target.checked = true;
}

async function loadSavedRoute(saved) {
  const validIds = new Set(BOOKSTORES.map((s) => s.id));
  state.selectedStoreIds = (saved.storeIds || []).filter((id) => validIds.has(id));
  state.stopOrderByStoreId = {};

  if (saved.origin) {
    setAutocompleteDisplayText(saved.origin.label || '');
    state.selectedOrigin = {
      label: saved.origin.label || QUICK_START_LOCATIONS[0].label,
      coords: saved.origin.coords ? { ...saved.origin.coords } : null,
      isCurrentLocation: Boolean(saved.origin.isCurrentLocation),
    };
  }

  setSelectedTravelMode(saved.travelMode || 'DRIVING');
  dom.departureTime.value = saved.departureTime || '';
  updateOriginReadout();
  renderQuickStartButtons();
  updateUseLocationButton();
  renderStoreList();
  refreshMarkers();
  clearNotice();

  if (state.map && state.selectedStoreIds.length > 0) {
    await calculateRoute();
  }
}

function applyRouteParamsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const stopsRaw = params.get('stops');
  if (!stopsRaw) return { shouldAutoRoute: false, hasCustomOrigin: false };

  const validIds = new Set(BOOKSTORES.map((s) => s.id));
  const parsedStops = stopsRaw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => validIds.has(id));

  if (parsedStops.length === 0) {
    return { shouldAutoRoute: false, hasCustomOrigin: false };
  }

  state.selectedStoreIds = [...new Set(parsedStops)];

  const mode = params.get('mode');
  if (mode === 'DRIVING' || mode === 'TRANSIT' || mode === 'BICYCLING') {
    setSelectedTravelMode(mode);
  }

  const time = params.get('time');
  if (time) {
    dom.departureTime.value = time;
  }

  const originLabel = params.get('origin');
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  const hasCustomOrigin = Boolean(originLabel || hasCoords);

  if (hasCustomOrigin) {
    state.selectedOrigin = {
      label: originLabel || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      coords: hasCoords ? { lat, lng } : null,
      isCurrentLocation: false,
    };
  }

  return { shouldAutoRoute: true, hasCustomOrigin };
}

function renderItinerary(routePlan, travelMode) {
  const fragment = document.createDocumentFragment();
  const modeLabels = {
    DRIVING: 'Drive',
    TRANSIT: 'MARTA / Transit',
    BICYCLING: 'Bike',
  };

  const summary = document.createElement('div');
  summary.className = 'itinerary-summary';

  const heading = document.createElement('h2');
  heading.className = 'itinerary-title';
  heading.textContent = 'Your Crawl Itinerary';

  const metrics = document.createElement('div');
  metrics.className = 'itinerary-metrics';
  metrics.innerHTML = `
    <span><strong>${formatDurationMs(routePlan.totalDurationMs)}</strong> total travel</span>
    <span aria-hidden="true">·</span>
    <span><strong>${formatMiles(routePlan.totalDistanceMeters)}</strong></span>
    <span aria-hidden="true">·</span>
    <span>${modeLabels[travelMode]}</span>
  `;

  const stopList = document.createElement('ol');
  stopList.className = 'stop-sequence';

  const originLi = document.createElement('li');
  originLi.className = 'stop-sequence-item';
  const originBadge = document.createElement('span');
  originBadge.className = 'stop-badge is-origin';
  originBadge.textContent = 'S';
  const originText = document.createElement('span');
  originText.textContent = state.selectedOrigin.label;
  originLi.appendChild(originBadge);
  originLi.appendChild(originText);
  stopList.appendChild(originLi);

  routePlan.orderedStores.forEach((store, idx) => {
    const li = document.createElement('li');
    li.className = 'stop-sequence-item';
    const badge = document.createElement('span');
    badge.className = 'stop-badge';
    badge.textContent = String(idx + 1);
    const name = document.createElement('span');
    name.textContent = `${store.name} (${store.neighborhood})`;
    li.appendChild(badge);
    li.appendChild(name);
    stopList.appendChild(li);
  });

  const actionsBar = document.createElement('div');
  actionsBar.className = 'itinerary-actions';

  const feedbackEl = document.createElement('p');
  feedbackEl.className = 'action-feedback';
  feedbackEl.hidden = true;

  const shareFallbackInput = document.createElement('input');
  shareFallbackInput.type = 'text';
  shareFallbackInput.readOnly = true;
  shareFallbackInput.className = 'text-input share-fallback-input';
  shareFallbackInput.hidden = true;
  shareFallbackInput.setAttribute('aria-label', 'Shareable route URL');
  shareFallbackInput.addEventListener('focus', () => shareFallbackInput.select());

  const saveFormRow = document.createElement('div');
  saveFormRow.className = 'save-route-row';
  saveFormRow.hidden = true;

  const saveNameInput = document.createElement('input');
  saveNameInput.type = 'text';
  saveNameInput.className = 'text-input save-route-input';
  saveNameInput.placeholder = 'Name this crawl...';
  saveNameInput.value = getDefaultCrawlName(routePlan.orderedStores);
  saveNameInput.setAttribute('aria-label', 'Crawl name');

  const saveConfirmBtn = document.createElement('button');
  saveConfirmBtn.type = 'button';
  saveConfirmBtn.className = 'save-route-confirm-btn';
  saveConfirmBtn.textContent = 'Save';

  const commitSave = () => {
    const savedOk = saveCurrentRoute(saveNameInput.value, routePlan, travelMode);
    saveFormRow.hidden = true;
    feedbackEl.hidden = false;
    feedbackEl.textContent = savedOk
      ? 'Crawl saved to your browser under Saved Crawls.'
      : 'Unable to save in this browser context (storage may be blocked).';
  };

  saveConfirmBtn.addEventListener('click', commitSave);
  saveNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitSave();
    }
  });

  saveFormRow.appendChild(saveNameInput);
  saveFormRow.appendChild(saveConfirmBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'itinerary-action-btn is-primary-action';
  saveBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
      <polyline points="17 21 17 13 7 13 7 21"></polyline>
      <polyline points="7 3 7 8 15 8"></polyline>
    </svg>
    <span>Save</span>
  `;
  saveBtn.addEventListener('click', () => {
    saveFormRow.hidden = !saveFormRow.hidden;
    feedbackEl.hidden = true;
    shareFallbackInput.hidden = true;
    if (!saveFormRow.hidden) {
      saveNameInput.focus();
      saveNameInput.select();
    }
  });

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'itinerary-action-btn';
  downloadBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
    <span>Download (.txt)</span>
  `;
  downloadBtn.addEventListener('click', () => {
    downloadItineraryText(routePlan, travelMode);
    feedbackEl.hidden = false;
    feedbackEl.textContent = 'Downloaded itinerary text file.';
  });

  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'itinerary-action-btn';
  shareBtn.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="18" cy="5" r="3"></circle>
      <circle cx="6" cy="12" r="3"></circle>
      <circle cx="18" cy="19" r="3"></circle>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
    </svg>
    <span>Share Link</span>
  `;
  shareBtn.addEventListener('click', async () => {
    const shareUrl = buildShareableRouteUrl(
      routePlan.orderedStores.map((s) => s.id),
      travelMode
    );
    saveFormRow.hidden = true;

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Atlanta Indie Bookshop Crawl Route',
          text: `Bookshop crawl route (${routePlan.orderedStores.length} stops · ${formatDurationMs(routePlan.totalDurationMs)})`,
          url: shareUrl,
        });
        feedbackEl.hidden = false;
        feedbackEl.textContent = 'Route link shared.';
        shareFallbackInput.hidden = true;
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }

    const copied = await copyTextToClipboard(shareUrl);
    feedbackEl.hidden = false;
    if (copied) {
      feedbackEl.textContent = 'Shareable route link copied to clipboard.';
      shareFallbackInput.hidden = true;
    } else {
      feedbackEl.textContent = 'Copy this shareable route link:';
      shareFallbackInput.value = shareUrl;
      shareFallbackInput.hidden = false;
      shareFallbackInput.focus();
      shareFallbackInput.select();
    }
  });

  const mapsLink = document.createElement('a');
  mapsLink.className = 'itinerary-action-btn';
  mapsLink.href = buildGoogleMapsDirectionsUrl(routePlan.orderedStores, travelMode);
  mapsLink.target = '_blank';
  mapsLink.rel = 'noopener noreferrer';
  mapsLink.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      <polyline points="15 3 21 3 21 9"></polyline>
      <line x1="10" y1="14" x2="21" y2="3"></line>
    </svg>
    <span>Google Maps</span>
  `;

  actionsBar.appendChild(saveBtn);
  actionsBar.appendChild(downloadBtn);
  actionsBar.appendChild(shareBtn);
  actionsBar.appendChild(mapsLink);

  summary.appendChild(heading);
  summary.appendChild(metrics);
  summary.appendChild(stopList);
  summary.appendChild(actionsBar);
  summary.appendChild(saveFormRow);
  summary.appendChild(feedbackEl);
  summary.appendChild(shareFallbackInput);
  fragment.appendChild(summary);

  const legsWrapper = document.createElement('div');
  legsWrapper.className = 'legs-list';

  routePlan.legs.forEach((entry, idx) => {
    const legCard = document.createElement('article');
    legCard.className = 'leg-card';

    const legHeader = document.createElement('div');
    legHeader.className = 'leg-header';

    const legTitle = document.createElement('h3');
    legTitle.className = 'leg-title';
    legTitle.textContent = `Leg ${idx + 1}: ${entry.fromLabel} → ${entry.toLabel}`;

    const legStats = document.createElement('span');
    legStats.className = 'leg-stats';
    const dur = entry.leg.localizedValues?.duration || formatDurationMs(entry.leg.durationMillis ?? 0);
    const dist = entry.leg.localizedValues?.distance || formatMiles(entry.leg.distanceMeters ?? 0);
    legStats.textContent = `${dur} · ${dist}`;

    legHeader.appendChild(legTitle);
    legHeader.appendChild(legStats);
    legCard.appendChild(legHeader);

    if (entry.leg.steps && entry.leg.steps.length > 0) {
      const stepsOl = document.createElement('ol');
      stepsOl.className = 'steps-list';

      entry.leg.steps.forEach((step) => {
        const stepLi = document.createElement('li');
        stepLi.className = 'step-item';
        stepLi.textContent = buildStepInstructionText(step);

        const stepDist = step.localizedValues?.distance;
        const stepDur = step.localizedValues?.staticDuration;
        if (stepDist || stepDur) {
          const stepMeta = document.createElement('span');
          stepMeta.className = 'step-meta';
          stepMeta.textContent = [stepDist, stepDur].filter(Boolean).join(' · ');
          stepLi.appendChild(stepMeta);
        }

        stepsOl.appendChild(stepLi);
      });

      legCard.appendChild(stepsOl);
    }

    legsWrapper.appendChild(legCard);
  });

  fragment.appendChild(legsWrapper);
  dom.itineraryContainer.replaceChildren(fragment);
}

async function calculateRoute(event) {
  if (event) event.preventDefault();
  clearNotice();

  const validation = validateCrawlForm();
  if (!validation.valid) return;

  const { selectedStores, originInput, travelMode, departureDate } = validation;

  if (travelMode === 'TRANSIT' && selectedStores.length > 1) {
    showNotice(
      'Transit route optimization is limited; routes will be calculated in the exact order selected.'
    );
  }

  dom.generateBtn.disabled = true;
  dom.generateBtn.textContent = 'Calculating Route...';
  clearRouteOverlays();
  dom.itineraryContainer.replaceChildren();

  try {
    const routePlan =
      travelMode === 'TRANSIT' && selectedStores.length > 1
        ? await computeChronologicalTransitRoute(originInput, selectedStores, departureDate)
        : await computeOptimizedRoute(originInput, selectedStores, travelMode, departureDate);

    renderRoute(routePlan, travelMode);
  } catch (error) {
    console.error('Route calculation failed:', error);
    showNotice(
      error?.message ||
        'Unable to calculate route. Please verify your starting address, selected stops, and API settings.',
      true
    );
  } finally {
    dom.generateBtn.disabled = false;
    dom.generateBtn.textContent = 'Generate Route';
  }
}

function attachStaticListeners() {
  dom.form.addEventListener('submit', calculateRoute);

  if (dom.setNowBtn && dom.departureTime) {
    dom.setNowBtn.addEventListener('click', () => {
      dom.departureTime.value = formatLocalDateTimeInput(new Date(Date.now() + 2 * 60 * 1000));
      setDepartureTimeError('');
      clearNotice();
    });
  }

  if (dom.departureTime) {
    const syncDepartureValidation = () => {
      const result = validateDepartureDate(getSelectedTravelMode());
      if (result.valid) {
        setDepartureTimeError('');
      } else if (dom.departureTime.classList.contains('is-invalid')) {
        setDepartureTimeError(result.message);
      }
    };
    dom.departureTime.addEventListener('input', syncDepartureValidation);
    dom.departureTime.addEventListener('change', syncDepartureValidation);
  }

  dom.form.querySelectorAll('input[name="travelMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (dom.departureTime?.classList.contains('is-invalid')) {
        const result = validateDepartureDate(getSelectedTravelMode());
        setDepartureTimeError(result.valid ? '' : result.message);
      }
    });
  });

  if (dom.useMyLocationBtn) {
    dom.useMyLocationBtn.addEventListener('click', () => {
      requestCurrentLocation({ silentIfBlocked: false });
    });
  }

  if (dom.storeFilter) {
    let filterAnnounceTimer = null;
    const handleFilterChange = ({ announceImmediately = false } = {}) => {
      const visibleCount = filterStoreList();
      window.clearTimeout(filterAnnounceTimer);
      const announce = () => {
        announceChecklistStatus(
          visibleCount === 0
            ? 'No participating bookstores match your filter.'
            : `Showing ${visibleCount} of ${BOOKSTORES.length} participating bookstores.`
        );
      };
      if (announceImmediately) {
        announce();
      } else {
        filterAnnounceTimer = window.setTimeout(announce, 350);
      }
    };

    dom.storeFilter.addEventListener('input', () => handleFilterChange());
    dom.storeFilter.addEventListener('search', () => handleFilterChange({ announceImmediately: true }));
    dom.storeFilter.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && dom.storeFilter.value) {
        dom.storeFilter.value = '';
        handleFilterChange({ announceImmediately: true });
      } else if (
        event.key === 'ArrowDown' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const firstCheckbox = dom.storeList?.querySelector(
          '.store-item:not([hidden]) .store-checkbox'
        );
        if (firstCheckbox) {
          event.preventDefault();
          firstCheckbox.focus();
        }
      }
    });
  }

  if (dom.storeList) {
    dom.storeList.addEventListener('keydown', (event) => {
      const target = event.target;
      const item = target?.closest?.('.store-item');
      if (!item || !dom.storeList.contains(item)) return;

      const isCheckbox = target.classList.contains('store-checkbox');
      const isDetailsBtn = target.classList.contains('store-details-btn');
      const isFocusBtn = target.classList.contains('store-focus-btn');
      if (!isCheckbox && !isDetailsBtn && !isFocusBtn) return;

      if (event.key === 'Enter' && isCheckbox) {
        event.preventDefault();
        const storeId = item.dataset.storeId;
        if (storeId) {
          target.checked = !target.checked;
          toggleStoreSelection(storeId, target.checked);
        }
        return;
      }

      if (event.key === 'ArrowRight') {
        const nextInRow = isCheckbox
          ? item.querySelector('.store-details-btn')
          : isDetailsBtn
            ? item.querySelector('.store-focus-btn')
            : null;
        if (nextInRow) {
          event.preventDefault();
          nextInRow.focus();
        }
        return;
      }

      if (event.key === 'ArrowLeft') {
        const prevInRow = isFocusBtn
          ? item.querySelector('.store-details-btn')
          : isDetailsBtn
            ? item.querySelector('.store-checkbox')
            : null;
        if (prevInRow) {
          event.preventDefault();
          prevInRow.focus();
        }
        return;
      }

      const visibleItems = Array.from(
        dom.storeList.querySelectorAll('.store-item:not([hidden])')
      );
      const currentIndex = visibleItems.indexOf(item);
      if (currentIndex === -1) return;

      let nextIndex = null;
      if (event.key === 'ArrowDown') {
        nextIndex = Math.min(currentIndex + 1, visibleItems.length - 1);
      } else if (event.key === 'ArrowUp') {
        nextIndex = Math.max(currentIndex - 1, 0);
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = visibleItems.length - 1;
      }

      if (nextIndex !== null) {
        event.preventDefault();
        const selector = isDetailsBtn
          ? '.store-details-btn'
          : isFocusBtn
            ? '.store-focus-btn'
            : '.store-checkbox';
        const nextControl = visibleItems[nextIndex]?.querySelector(selector);
        if (nextControl) {
          nextControl.focus();
          visibleItems[nextIndex].scrollIntoView({ block: 'nearest' });
        }
      }
    });
  }

  dom.selectAllBtn.addEventListener('click', () => {
    const visibleIds = getFilteredStores().map((store) => store.id);
    const merged = new Set([...state.selectedStoreIds, ...visibleIds]);
    state.selectedStoreIds = BOOKSTORES.filter((store) => merged.has(store.id)).map(
      (store) => store.id
    );
    state.stopOrderByStoreId = {};
    if (state.selectedStoreIds.length > 0) {
      setStoreSelectionError('');
    }
    renderStoreList();
    refreshMarkers();

    const msg = `Selected ${visibleIds.length} visible bookshops. ${state.selectedStoreIds.length} of ${BOOKSTORES.length} total selected.`;
    announceChecklistStatus(msg);
    announceMapStatus(`Map markers updated: ${state.selectedStoreIds.length} bookshops selected.`);
  });

  dom.clearStoresBtn.addEventListener('click', () => {
    state.selectedStoreIds = [];
    clearRouteOverlays();
    dom.itineraryContainer.replaceChildren();
    dom.resetBtn.hidden = true;
    clearValidationErrors();
    clearNotice();
    announceChecklistStatus('Cleared all selected bookstores. 0 of 36 selected.');
    announceMapStatus('All bookstore selections and route markers cleared from the map.');
  });

  dom.resetBtn.addEventListener('click', () => {
    clearRouteOverlays();
    dom.itineraryContainer.replaceChildren();
    dom.resetBtn.hidden = true;
    clearValidationErrors();
    clearNotice();
    if (state.map) {
      state.map.panTo(ATLANTA_CENTER);
      state.map.setZoom(10);
    }
    announceMapStatus('Route and numbered stop markers cleared from the map.');
  });
}

async function initApp() {
  const { shouldAutoRoute, hasCustomOrigin } = applyRouteParamsFromUrl();
  renderStoreList();
  renderSavedRoutes();
  attachStaticListeners();

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    dom.mapContainer.innerHTML = `
      <div class="map-error-fallback">
        <h2>Google Maps API Key Missing</h2>
        <p>Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your <code>.env</code> file and restart the dev server.</p>
      </div>
    `;
    return;
  }

  setOptions({
    key: apiKey,
    v: 'weekly',
  });

  try {
    const [mapsLib, placesLib, routesLib, markerLib, coreLib] = await Promise.all([
      importLibrary('maps'),
      importLibrary('places'),
      importLibrary('routes'),
      importLibrary('marker'),
      importLibrary('core'),
    ]);

    state.libs = {
      maps: mapsLib,
      places: placesLib,
      routes: routesLib,
      marker: markerLib,
      core: coreLib,
    };

    const { Map: GoogleMap, InfoWindow } = mapsLib;
    // mapId is required to render AdvancedMarkerElement instances.
    state.map = new GoogleMap(dom.mapContainer, {
      center: ATLANTA_CENTER,
      zoom: 10,
      mapId: 'DEMO_MAP_ID',
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      internalUsageAttributionIds: [USAGE_ATTRIBUTION_ID],
    });

    state.infoWindow = new InfoWindow();
    state.infoWindow.addListener('closeclick', () => {
      announceMapStatus('Closed bookstore marker details.');
    });
    renderStoreMarkers();
    initAutocomplete();

    if (shouldAutoRoute) {
      await calculateRoute();
    } else if (!hasCustomOrigin && navigator.permissions?.query) {
      // Auto-detect current location on load only if permission was already granted.
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (status.state === 'granted') {
            requestCurrentLocation({ silentIfBlocked: true });
          }
        })
        .catch(() => {});
    }
  } catch (error) {
    console.error('Failed to load Google Maps Platform libraries:', error);
    showNotice(
      'Unable to load Google Maps. Please check your network connection and API key configuration.',
      true
    );
  }
}

initApp();
