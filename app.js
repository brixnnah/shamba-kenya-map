const STORAGE_KEY = 'shamba.parcels.v1';
const DEFAULT_CENTER = [-1.286389, 36.817223];
const DEFAULT_ZOOM = 6;
const MAP_STYLE = {
  color: '#4f8145',
  weight: 2,
  opacity: 0.95,
  fillColor: '#b8df81',
  fillOpacity: 0.28
};

const elements = {
  list: document.getElementById('parcelList'),
  count: document.getElementById('parcelCount'),
  connection: document.getElementById('connectionStatus'),
  connectionText: document.getElementById('connectionText'),
  locationName: document.getElementById('locationName'),
  mapHeading: document.getElementById('mapHeading'),
  mapSubheading: document.getElementById('mapSubheading'),
  mappingPanel: document.getElementById('mappingPanel'),
  pointCount: document.getElementById('pointCount'),
  accuracy: document.getElementById('accuracy'),
  areaReadout: document.getElementById('areaReadout'),
  undoPoint: document.getElementById('undoPoint'),
  finishMapping: document.getElementById('finishMapping'),
  mappingHint: document.getElementById('mappingHint'),
  gpsToast: document.getElementById('gpsToast'),
  parcelDialog: document.getElementById('parcelDialog'),
  parcelForm: document.getElementById('parcelForm'),
  detailsDialog: document.getElementById('detailsDialog'),
  sidebar: document.getElementById('sidebar')
};

let parcels = loadParcels();
let map;
let draftPoints = [];
let draftLayer;
let savedLayers = new Map();
let locationMarker;
let watchId = null;
let recording = false;
let manualMode = false;
let toastTimer;
let activeParcelId = null;

function loadParcels() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((parcel) =>
      parcel && typeof parcel.id === 'string' && typeof parcel.name === 'string' &&
      Array.isArray(parcel.points) && parcel.points.every((point) =>
        Array.isArray(point) && point.length === 2 &&
        Number.isFinite(point[0]) && Number.isFinite(point[1])
      )
    ) : [];
  } catch (error) {
    console.error('Could not load saved parcel records.', error);
    return [];
  }
}

function persistParcels() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parcels));
  } catch (error) {
    showToast('Could not save. Check available device storage.');
    console.error('Could not save parcel records.', error);
    return false;
  }
  return true;
}

function initialiseMap() {
  if (!window.L) {
    showToast('Map library could not load. Connect to the internet and refresh.');
    return;
  }
  map = L.map('map', { zoomControl: false, preferCanvas: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  draftLayer = L.featureGroup().addTo(map);
  map.on('click', onMapClick);
  renderParcels();
  updateConnection();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.error('Offline app setup failed.', error);
    });
  }
}

function formatArea(points) {
  if (points.length < 3) return '—';
  const area = L.GeometryUtil
    ? L.GeometryUtil.geodesicArea(points.map((point) => L.latLng(point[0], point[1])))
    : calculateArea(points);
  if (!Number.isFinite(area) || area <= 0) return '—';
  if (area >= 1000000) return `${(area / 1000000).toFixed(2)} km²`;
  if (area >= 10000) return `${(area / 10000).toFixed(2)} ha`;
  return `${Math.round(area)} m²`;
}

function calculateArea(points) {
  const earthRadius = 6378137;
  const coordinates = points.map(([latitude, longitude]) => [
    longitude * Math.PI / 180,
    latitude * Math.PI / 180
  ]);
  let total = 0;
  for (let index = 0; index < coordinates.length; index += 1) {
    const current = coordinates[index];
    const next = coordinates[(index + 1) % coordinates.length];
    total += (next[0] - current[0]) *
      (2 + Math.sin(current[1]) + Math.sin(next[1]));
  }
  return Math.abs(total * earthRadius * earthRadius / 2);
}

function parcelArea(parcel) {
  return formatArea(parcel.points);
}

function renderParcels() {
  elements.list.replaceChildren();
  elements.count.textContent = String(parcels.length);
  if (parcels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-parcels';
    empty.textContent = 'Your saved parcels will appear here. Start by mapping one on the ground.';
    elements.list.append(empty);
  }

  const currentIds = new Set(parcels.map((parcel) => parcel.id));
  for (const [id, layer] of savedLayers) {
    if (!currentIds.has(id)) {
      map.removeLayer(layer);
      savedLayers.delete(id);
    }
  }

  parcels.forEach((parcel) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'parcel-card';
    const icon = document.createElement('span');
    icon.className = 'parcel-symbol';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⌖';
    const copy = document.createElement('span');
    copy.className = 'parcel-card-copy';
    const name = document.createElement('strong');
    name.textContent = parcel.name;
    const detail = document.createElement('span');
    detail.textContent = [parcel.county || 'Kenya', parcelArea(parcel)].join(' · ');
    copy.append(name, detail);
    const arrow = document.createElement('span');
    arrow.className = 'parcel-chevron';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '›';
    button.append(icon, copy, arrow);
    button.addEventListener('click', () => openParcelDetails(parcel.id));
    elements.list.append(button);

    let layer = savedLayers.get(parcel.id);
    if (!layer) {
      layer = L.featureGroup();
      savedLayers.set(parcel.id, layer);
    }
    layer.clearLayers();
    const polygon = L.polygon(parcel.points, MAP_STYLE);
    polygon.on('click', () => openParcelDetails(parcel.id));
    layer.addLayer(polygon);
    const markerIcon = L.divIcon({ className: '', html: '<div class="parcel-marker"></div>', iconSize: [29, 29], iconAnchor: [14, 27] });
    const marker = L.marker(parcel.points[0], { icon: markerIcon });
    marker.on('click', () => openParcelDetails(parcel.id));
    layer.addLayer(marker);
    layer.addTo(map);
  });
}

function updateConnection() {
  const online = navigator.onLine;
  elements.connection.classList.toggle('offline', !online);
  elements.connectionText.textContent = online ? 'Online' : 'Offline · saved on device';
}

function showToast(message) {
  elements.gpsToast.textContent = message;
  elements.gpsToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.gpsToast.classList.add('hidden'), 4200);
}

function updateDraft() {
  draftLayer.clearLayers();
  if (draftPoints.length > 1) {
    L.polyline(draftPoints, { color: '#4f8145', weight: 3, dashArray: '7 7', opacity: 0.9 }).addTo(draftLayer);
  }
  draftPoints.forEach((point, index) => {
    const marker = L.circleMarker(point, {
      radius: index === 0 ? 6 : 4,
      color: '#fff',
      weight: 2,
      fillColor: '#54864a',
      fillOpacity: 1
    }).addTo(draftLayer);
    marker.bindTooltip(String(index + 1), { direction: 'top', offset: [0, -4], opacity: 0.9 });
  });
  elements.pointCount.textContent = String(draftPoints.length);
  elements.areaReadout.textContent = formatArea(draftPoints);
  elements.undoPoint.disabled = draftPoints.length === 0;
  elements.finishMapping.disabled = draftPoints.length < 3;
}

function addPoint(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    showToast('That location is outside valid GPS coordinates.');
    return;
  }
  const point = [latitude, longitude];
  const previous = draftPoints[draftPoints.length - 1];
  if (previous && map.distance(previous, point) < 1) return;
  draftPoints.push(point);
  updateDraft();
}

function onMapClick(event) {
  if (!recording || !manualMode) return;
  addPoint(event.latlng.lat, event.latlng.lng);
}

function beginMapping() {
  if (!map) return;
  if (recording) return;
  recording = true;
  manualMode = false;
  draftPoints = [];
  updateDraft();
  elements.mappingPanel.classList.remove('hidden');
  elements.mapHeading.textContent = 'Mapping your boundary';
  elements.mapSubheading.textContent = 'Walk the edge of your parcel. GPS points are saved locally as you go.';
  elements.mappingHint.textContent = 'Start a GPS recording or add points by tapping the map. Need at least 3 points to save.';
  document.getElementById('mappingTitle').textContent = 'Walk the boundary';
  if (!navigator.geolocation) {
    elements.mappingHint.textContent = 'GPS is not available in this browser. Tap the map to add boundary points.';
    showToast('GPS unavailable. You can add points by tapping the map.');
    return;
  }
  if (!window.isSecureContext) {
    elements.mappingHint.textContent = 'GPS requires HTTPS. Tap the map to add points or open this app on a secure connection.';
    showToast('GPS requires a secure (HTTPS) connection. Manual map points are available.');
    return;
  }
  watchId = navigator.geolocation.watchPosition(onPosition, onLocationError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 15000
  });
}

function onPosition(position) {
  const { latitude, longitude, accuracy: gpsAccuracy } = position.coords;
  elements.accuracy.textContent = `${Math.round(gpsAccuracy)} m`;
  if (!locationMarker) {
    const icon = L.divIcon({ className: '', html: '<div class="user-marker"></div>', iconSize: [17, 17], iconAnchor: [8, 8] });
    locationMarker = L.marker([latitude, longitude], { icon, zIndexOffset: 1000 }).addTo(map);
  } else {
    locationMarker.setLatLng([latitude, longitude]);
  }
  elements.locationName.textContent = 'Current location';
  if (!manualMode && recording) {
    if (gpsAccuracy > 35) {
      elements.mappingHint.textContent = `GPS accuracy is ${Math.round(gpsAccuracy)} m. Wait for a stronger fix before recording this point.`;
      return;
    }
    elements.mappingHint.textContent = 'Good GPS fix. Walk slowly along your boundary; points are recorded as you move.';
    addPoint(latitude, longitude);
    if (draftPoints.length === 1) map.setView([latitude, longitude], Math.max(map.getZoom(), 17));
  }
}

function onLocationError(error) {
  const messages = {
    1: 'Location permission denied. Allow location access or add points by tapping the map.',
    2: 'GPS location is unavailable. Try moving outdoors or use map taps.',
    3: 'GPS timed out. Waiting for a new fix, or tap the map to add points.'
  };
  const message = messages[error.code] || 'Could not read GPS location. Try tapping the map to add points.';
  elements.mappingHint.textContent = message;
  showToast(message);
}

function stopRecording() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  recording = false;
}

function endMapping() {
  stopRecording();
  manualMode = false;
  draftPoints = [];
  draftLayer.clearLayers();
  elements.mappingPanel.classList.add('hidden');
  elements.mapHeading.textContent = parcels.length ? 'Your land, at a glance.' : 'Your land, at a glance.';
  elements.mapSubheading.textContent = 'Map a boundary on the ground or explore your saved parcels.';
}

function showParcelForm() {
  if (draftPoints.length < 3) return;
  stopRecording();
  elements.parcelDialog.showModal();
  elements.parcelForm.elements.name.focus();
}

function saveParcel(event) {
  event.preventDefault();
  const form = new FormData(elements.parcelForm);
  const parcel = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: String(form.get('name') || '').trim(),
    county: String(form.get('county') || '').trim(),
    deedNumber: String(form.get('deedNumber') || '').trim(),
    notes: String(form.get('notes') || '').trim(),
    points: draftPoints.map(([latitude, longitude]) => [latitude, longitude]),
    createdAt: new Date().toISOString()
  };
  if (!parcel.name || parcel.points.length < 3) return;
  parcels.unshift(parcel);
  if (!persistParcels()) {
    parcels.shift();
    return;
  }
  renderParcels();
  elements.parcelDialog.close();
  elements.parcelForm.reset();
  draftPoints = [];
  draftLayer.clearLayers();
  elements.mappingPanel.classList.add('hidden');
  elements.mapHeading.textContent = 'Your land, at a glance.';
  elements.mapSubheading.textContent = 'Your parcel is saved on this device.';
  const layer = savedLayers.get(parcel.id);
  if (layer) map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 17 });
  showToast('Parcel saved on this device.');
}

function openParcelDetails(id) {
  const parcel = parcels.find((item) => item.id === id);
  if (!parcel) return;
  activeParcelId = id;
  document.getElementById('detailsName').textContent = parcel.name;
  document.getElementById('detailsCounty').textContent = parcel.county || 'Not added';
  document.getElementById('detailsArea').textContent = parcelArea(parcel);
  document.getElementById('detailsDeed').textContent = parcel.deedNumber || 'Not added';
  document.getElementById('detailsPoints').textContent = `${parcel.points.length} GPS points`;
  document.getElementById('detailsNotes').textContent = parcel.notes || 'No notes';
  elements.detailsDialog.showModal();
}

function viewActiveParcel() {
  const layer = savedLayers.get(activeParcelId);
  if (layer) {
    elements.detailsDialog.close();
    map.fitBounds(layer.getBounds(), { padding: [70, 70], maxZoom: 17 });
  }
}

function deleteActiveParcel() {
  const parcel = parcels.find((item) => item.id === activeParcelId);
  if (!parcel || !window.confirm(`Delete "${parcel.name}" from this device? This cannot be undone.`)) return;
  parcels = parcels.filter((item) => item.id !== activeParcelId);
  if (!persistParcels()) {
    parcels.unshift(parcel);
    return;
  }
  renderParcels();
  elements.detailsDialog.close();
  showToast('Parcel deleted from this device.');
}

function findLocation() {
  if (!navigator.geolocation) {
    showToast('Location is not available in this browser.');
    return;
  }
  if (!window.isSecureContext) {
    showToast('Location requires an HTTPS connection.');
    return;
  }
  navigator.geolocation.getCurrentPosition((position) => {
    const point = [position.coords.latitude, position.coords.longitude];
    map.setView(point, 17);
    onPosition(position);
    showToast('Map centered on your location.');
  }, onLocationError, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}

document.getElementById('startMapping').addEventListener('click', beginMapping);
document.getElementById('finishMapping').addEventListener('click', showParcelForm);
document.getElementById('closeMapping').addEventListener('click', endMapping);
document.getElementById('cancelDialog').addEventListener('click', () => elements.parcelDialog.close());
document.getElementById('closeDetails').addEventListener('click', () => elements.detailsDialog.close());
document.getElementById('undoPoint').addEventListener('click', () => {
  draftPoints.pop();
  updateDraft();
});
document.getElementById('manualPoint').addEventListener('click', () => {
  manualMode = true;
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  elements.mappingHint.textContent = 'Tap your parcel boundary on the map to add each point. Add at least 3 points.';
});
document.getElementById('locateMe').addEventListener('click', findLocation);
document.getElementById('mapLocate').addEventListener('click', findLocation);
document.getElementById('zoomIn').addEventListener('click', () => map && map.zoomIn());
document.getElementById('zoomOut').addEventListener('click', () => map && map.zoomOut());
document.getElementById('viewParcel').addEventListener('click', viewActiveParcel);
document.getElementById('deleteParcel').addEventListener('click', deleteActiveParcel);
elements.parcelForm.addEventListener('submit', saveParcel);
document.getElementById('mobileMenu').addEventListener('click', () => elements.sidebar.classList.toggle('open'));
document.addEventListener('click', (event) => {
  if (window.innerWidth <= 650 && elements.sidebar.classList.contains('open') &&
      !elements.sidebar.contains(event.target) && !event.target.closest('#mobileMenu')) {
    elements.sidebar.classList.remove('open');
  }
});
window.addEventListener('online', updateConnection);
window.addEventListener('offline', updateConnection);
window.addEventListener('beforeunload', stopRecording);
initialiseMap();
