import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { ATLANTA_CENTER, BOOKSTORES, QUICK_START_LOCATIONS } from './data.js';

const USAGE_ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';

const MAX_ROUTE_STOPS = 26;

const state = {
  map: null,
  infoWindow: null,
  autocompleteEl: null,
  selectedOrigin: {
    label: QUICK_START_LOCATIONS[0].label,
    coords: { ...QUICK_START_LOCATIONS[0].coords },
  },
  selectedStoreIds: BOOKSTORES.filter((store) => store.defaultSelected).map((store) => store.id),
  filterQuery: '',
  stopOrderByStoreId: {},
  storeMarkers: new Map(),
  originMarker: null,
  routePolylines: [],
  libs: {},
};

const dom = {
  form: document.getElementById('crawl-form'),
  autocompleteContainer: document.getElementById('start-autocomplete-container'),
  quickStartButtons: document.getElementById('quick-start-buttons'),
  originReadout: document.getElementById('selected-origin-readout'),
  departureTime: document.getElementById('departure-time'),
  selectedCount: document.getElementById('selected-count'),
  storeFilter: document.getElementById('store-filter'),
  storeList: document.getElementById('store-list'),
  selectAllBtn: document.getElementById('select-all-btn'),
  clearStoresBtn: document.getElementById('clear-stores-btn'),
  noticeBanner: document.getElementById('route-notice'),
  generateBtn: document.getElementById('generate-route-btn'),
  resetBtn: document.getElementById('reset-route-btn'),
  itineraryContainer: document.getElementById('itinerary-container'),
  mapContainer: document.getElementById('map'),
};

function createBookPinElement(store, isSelected, stopOrder) {
  const pin = document.createElement('div');
  pin.className = `book-marker${isSelected ? ' is-selected' : ''}`;
  pin.setAttribute('role', 'button');
  pin.setAttribute('aria-label', store.name);

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

function createOriginPinElement() {
  const pin = document.createElement('div');
  pin.className = 'origin-marker';
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

function updateOriginReadout() {
  if (state.selectedOrigin.label) {
    dom.originReadout.textContent = `Starting from: ${state.selectedOrigin.label}`;
  } else {
    dom.originReadout.textContent = '';
  }
}

function renderQuickStartButtons() {
  const fragment = document.createDocumentFragment();
  QUICK_START_LOCATIONS.forEach((loc) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quick-pick-btn';
    if (state.selectedOrigin.label === loc.label) {
      btn.classList.add('is-active');
    }
    btn.textContent = loc.shortLabel;
    btn.addEventListener('click', () => {
      state.selectedOrigin = {
        label: loc.label,
        coords: { ...loc.coords },
      };
      if (state.autocompleteEl) {
        state.autocompleteEl.value = loc.label;
      }
      updateOriginReadout();
      renderQuickStartButtons();
      clearNotice();
    });
    fragment.appendChild(btn);
  });
  dom.quickStartButtons.replaceChildren(fragment);
}

function getFilteredStores() {
  const query = state.filterQuery.trim().toLowerCase();
  if (!query) return BOOKSTORES;
  return BOOKSTORES.filter(
    (store) =>
      store.name.toLowerCase().includes(query) ||
      store.neighborhood.toLowerCase().includes(query) ||
      store.address.toLowerCase().includes(query)
  );
}

function renderStoreList() {
  if (dom.selectedCount) {
    dom.selectedCount.textContent = String(state.selectedStoreIds.length);
  }

  const visibleStores = getFilteredStores();
  const fragment = document.createDocumentFragment();

  if (visibleStores.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'store-empty-row';
    emptyLi.textContent = 'No participating shops match your filter.';
    fragment.appendChild(emptyLi);
    dom.storeList.replaceChildren(fragment);
    return;
  }

  visibleStores.forEach((store) => {
    const isSelected = state.selectedStoreIds.includes(store.id);
    const stopOrder = state.stopOrderByStoreId[store.id];

    const li = document.createElement('li');
    li.className = 'store-item';

    const row = document.createElement('div');
    row.className = `store-row${isSelected ? ' is-selected' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `store-${store.id}`;
    checkbox.className = 'store-checkbox';
    checkbox.checked = isSelected;
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
    meta.textContent = [store.neighborhood, store.instagram].filter(Boolean).join(' · ');

    const address = document.createElement('div');
    address.className = 'store-address';
    address.textContent = store.address;

    details.appendChild(titleRow);
    details.appendChild(meta);
    details.appendChild(address);

    const focusBtn = document.createElement('button');
    focusBtn.type = 'button';
    focusBtn.className = 'store-focus-btn';
    focusBtn.textContent = 'View';
    focusBtn.setAttribute('aria-label', `Center map on ${store.name}`);
    focusBtn.addEventListener('click', () => focusStoreOnMap(store));

    row.appendChild(checkbox);
    row.appendChild(details);
    row.appendChild(focusBtn);
    li.appendChild(row);
    fragment.appendChild(li);
  });

  dom.storeList.replaceChildren(fragment);
}

function refreshMarkers() {
  BOOKSTORES.forEach((store) => {
    const marker = state.storeMarkers.get(store.id);
    if (!marker) return;
    const isSelected = state.selectedStoreIds.includes(store.id);
    const stopOrder = state.stopOrderByStoreId[store.id];
    marker.replaceChildren(createBookPinElement(store, isSelected, stopOrder));
  });
}

function toggleStoreSelection(storeId, shouldInclude) {
  if (shouldInclude && !state.selectedStoreIds.includes(storeId)) {
    state.selectedStoreIds.push(storeId);
  } else if (!shouldInclude) {
    state.selectedStoreIds = state.selectedStoreIds.filter((id) => id !== storeId);
  }
  state.stopOrderByStoreId = {};
  renderStoreList();
  refreshMarkers();
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
      const ig = document.createElement('span');
      ig.textContent = `IG ${store.instagram}`;
      links.appendChild(ig);
    }
    card.appendChild(links);
  }

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = `info-window-btn${isSelected ? ' is-included' : ''}`;
  toggleBtn.textContent = isSelected ? 'Remove from Crawl' : 'Add to Crawl';
  toggleBtn.addEventListener('click', () => {
    toggleStoreSelection(store.id, !isSelected);
    state.infoWindow.setContent(buildInfoWindowContent(store));
  });

  card.appendChild(toggleBtn);
  return card;
}

function focusStoreOnMap(store) {
  if (!state.map || !state.infoWindow) return;
  const marker = state.storeMarkers.get(store.id);
  state.map.panTo(store.coords);
  if ((state.map.getZoom() ?? 12) < 13) {
    state.map.setZoom(14);
  }
  if (marker) {
    state.infoWindow.setContent(buildInfoWindowContent(store));
    state.infoWindow.open({ anchor: marker, map: state.map });
  }
}

function renderStoreMarkers() {
  const { AdvancedMarkerElement } = state.libs.marker;

  BOOKSTORES.forEach((store) => {
    const isSelected = state.selectedStoreIds.includes(store.id);
    const marker = new AdvancedMarkerElement({
      map: state.map,
      position: store.coords,
      title: store.name,
    });
    marker.append(createBookPinElement(store, isSelected, null));

    // Standard 'click' on AdvancedMarkerElement works across all API channels including weekly.
    marker.addListener('click', () => {
      state.infoWindow.setContent(buildInfoWindowContent(store));
      state.infoWindow.open({ anchor: marker, map: state.map });
    });

    state.storeMarkers.set(store.id, marker);
  });
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
    };
    updateOriginReadout();
    renderQuickStartButtons();
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
      };
      updateOriginReadout();
      renderQuickStartButtons();
      clearNotice();
    }
  });

  state.autocompleteEl = autocomplete;
  dom.autocompleteContainer.appendChild(autocomplete);
  updateOriginReadout();
  renderQuickStartButtons();
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

function getSelectedDepartureDate(travelMode) {
  const raw = dom.departureTime.value;
  if (!raw) return { date: null, notice: null };

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { date: null, notice: null };
  }

  // Routes API rejects past departureTime values for DRIVING.
  if (travelMode === 'DRIVING' && parsed.getTime() <= Date.now()) {
    return {
      date: null,
      notice: 'Driving traffic predictions require a future departure time; calculating route using current traffic.',
    };
  }

  return { date: parsed, notice: null };
}

async function computeOptimizedRoute(originInput, selectedStores, travelMode, departureDate) {
  const { Route } = state.libs.routes;
  const lastStore = selectedStores[selectedStores.length - 1];
  const intermediateStores = selectedStores.slice(0, -1);

  const request = {
    origin: originInput,
    destination: lastStore.coords,
    travelMode,
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
      request.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
      request.trafficModel = 'BEST_GUESS';
    } else {
      request.routingPreference = 'TRAFFIC_AWARE';
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
  const { Route } = state.libs.routes;
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
      travelMode: 'TRANSIT',
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
    state.originMarker.append(createOriginPinElement());
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

  renderItinerary(routePlan, travelMode);
  dom.resetBtn.hidden = false;
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

  summary.appendChild(heading);
  summary.appendChild(metrics);
  summary.appendChild(stopList);
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
  event.preventDefault();
  clearNotice();

  const selectedStores = BOOKSTORES.filter((store) => state.selectedStoreIds.includes(store.id));
  if (selectedStores.length === 0) {
    showNotice('Select at least one independent bookstore to plan your crawl.', true);
    return;
  }

  const originText =
    state.selectedOrigin.label || state.autocompleteEl?.value?.trim() || '';
  if (!originText && !state.selectedOrigin.coords) {
    showNotice('Enter or choose a starting location in Atlanta.', true);
    return;
  }

  const originInput = state.selectedOrigin.coords || originText;
  const travelMode = getSelectedTravelMode();

  // Google Routes API supports up to 25 intermediate waypoints plus 1 destination (26 bookshop stops).
  if (travelMode !== 'TRANSIT' && selectedStores.length > MAX_ROUTE_STOPS) {
    showNotice(
      `Google Routes supports up to ${MAX_ROUTE_STOPS} bookshop stops per route. Please uncheck ${selectedStores.length - MAX_ROUTE_STOPS} shop(s) or plan in regional segments.`,
      true
    );
    return;
  }

  const { date: departureDate, notice: timeNotice } = getSelectedDepartureDate(travelMode);

  if (travelMode === 'TRANSIT' && selectedStores.length > 1) {
    showNotice(
      'Transit route optimization is limited; routes will be calculated in the exact order selected.'
    );
  } else if (timeNotice) {
    showNotice(timeNotice);
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

  if (dom.storeFilter) {
    dom.storeFilter.addEventListener('input', () => {
      state.filterQuery = dom.storeFilter.value;
      renderStoreList();
    });
  }

  dom.selectAllBtn.addEventListener('click', () => {
    const visibleIds = getFilteredStores().map((store) => store.id);
    const merged = new Set([...state.selectedStoreIds, ...visibleIds]);
    state.selectedStoreIds = BOOKSTORES.filter((store) => merged.has(store.id)).map(
      (store) => store.id
    );
    state.stopOrderByStoreId = {};
    renderStoreList();
    refreshMarkers();
  });

  dom.clearStoresBtn.addEventListener('click', () => {
    state.selectedStoreIds = [];
    clearRouteOverlays();
    dom.itineraryContainer.replaceChildren();
    dom.resetBtn.hidden = true;
    clearNotice();
  });

  dom.resetBtn.addEventListener('click', () => {
    clearRouteOverlays();
    dom.itineraryContainer.replaceChildren();
    dom.resetBtn.hidden = true;
    clearNotice();
    if (state.map) {
      state.map.panTo(ATLANTA_CENTER);
      state.map.setZoom(10);
    }
  });
}

async function initApp() {
  renderStoreList();
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
    renderStoreMarkers();
    initAutocomplete();
  } catch (error) {
    console.error('Failed to load Google Maps Platform libraries:', error);
    showNotice(
      'Unable to load Google Maps. Please check your network connection and API key configuration.',
      true
    );
  }
}

initApp();
