const STORAGE_KEY = 'shamba.parcels.v1';
const DOCUMENT_DATABASE = 'shamba.documents.v1';
const MAX_DOCUMENT_SIZE = 25 * 1024 * 1024;
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
  roadAttribution: document.getElementById('roadAttribution'),
  satelliteAttribution: document.getElementById('satelliteAttribution'),
  mapHeading: document.getElementById('mapHeading'),
  mapSubheading: document.getElementById('mapSubheading'),
  locationSearchForm: document.getElementById('locationSearchForm'),
  locationSearchInput: document.getElementById('locationSearchInput'),
  locationSearchResults: document.getElementById('locationSearchResults'),
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
let streetLayer;
let satelliteLayer;
let satelliteLabelsLayer;
let satelliteView = false;
let searchMarker;
let searchInProgress = false;
let lastLocationSearchAt = 0;
let draftPoints = [];
let draftLayer;
let savedLayers = new Map();
let locationMarker;
let watchId = null;
let recording = false;
let manualMode = false;
let toastTimer;
let activeParcelId = null;
let pendingDeedPhoto = '';
let savingParcel = false;

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

function createRecordId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function openDocumentDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Document storage is not supported in this browser.'));
      return;
    }
    const request = indexedDB.open(DOCUMENT_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('documents')) {
        request.result.createObjectStore('documents');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open document storage.'));
    request.onblocked = () => reject(new Error('Document storage is blocked by another tab. Close other tabs and try again.'));
  });
}

async function storeDocumentFile(id, file) {
  const database = await openDocumentDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('documents', 'readwrite');
      transaction.objectStore('documents').put(file, id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not save the document.'));
      transaction.onabort = () => reject(transaction.error || new Error('Document save was cancelled.'));
    });
  } finally {
    database.close();
  }
}

async function getDocumentFile(id) {
  const database = await openDocumentDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('documents', 'readonly');
      const request = transaction.objectStore('documents').get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read the saved document.'));
    });
  } finally {
    database.close();
  }
}

async function deleteDocumentFile(id) {
  const database = await openDocumentDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('documents', 'readwrite');
      transaction.objectStore('documents').delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not remove the saved document.'));
      transaction.onabort = () => reject(transaction.error || new Error('Document removal was cancelled.'));
    });
  } finally {
    database.close();
  }
}

function validateDocuments(files) {
  const supportedExtension = /\.(pdf|docx?|xlsx?|odt|ods|txt|rtf)$/i;
  for (const file of files) {
    if (!file.type.startsWith('image/') && !supportedExtension.test(file.name)) {
      throw new Error('Choose a PDF, Word, Excel, text, or image file.');
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      throw new Error('Each document must be 25 MB or smaller.');
    }
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function showSelectedDocuments(files) {
  const list = document.getElementById('newDocumentList');
  list.replaceChildren();
  for (const file of files) {
    const item = document.createElement('li');
    item.textContent = `${file.name} · ${formatFileSize(file.size)}`;
    list.append(item);
  }
  list.classList.toggle('hidden', files.length === 0);
}

async function saveDocumentFiles(files, createdIds) {
  const records = [];
  for (const file of files) {
    const record = {
      id: createRecordId(),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size
    };
    await storeDocumentFile(record.id, file);
    createdIds.push(record.id);
    records.push(record);
  }
  return records;
}

async function cleanupDocumentFiles(ids) {
  for (const id of ids) {
    try {
      await deleteDocumentFile(id);
    } catch (error) {
      console.error('Could not clean up an unsaved document.', error);
      showToast('Some temporary document data could not be removed. Check device storage.');
    }
  }
}

function renderDocumentList(parcel) {
  const list = document.getElementById('detailsDocuments');
  list.replaceChildren();
  const documents = Array.isArray(parcel.documents) ? parcel.documents : [];
  if (documents.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'attachment-empty';
    empty.textContent = 'No documents attached';
    list.append(empty);
    return;
  }

  documents.forEach((record) => {
    const item = document.createElement('li');
    item.className = 'attachment-item';
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = record.name;
    const size = document.createElement('span');
    size.textContent = formatFileSize(record.size);
    copy.append(name, size);
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'secondary-button attachment-download';
    download.textContent = 'Download';
    download.setAttribute('aria-label', `Download ${record.name}`);
    download.addEventListener('click', () => downloadDocument(record));
    item.append(copy, download);
    list.append(item);
  });
}

async function downloadDocument(record) {
  try {
    const file = await getDocumentFile(record.id);
    if (!file) throw new Error('This file is missing from this device. It may have been removed from browser storage.');
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = record.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    console.error('Could not download the attached document.', error);
    showToast(error.message || 'Could not open the attached document.');
  }
}

function initialiseMap() {
  if (!window.L) {
    showToast('Map library could not load. Connect to the internet and refresh.');
    return;
  }
  map = L.map('map', { zoomControl: false, preferCanvas: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
  streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19 }
  );
  satelliteLabelsLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19 }
  );
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

function formatVisit(value, compact = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not recorded yet';
  return new Intl.DateTimeFormat(undefined, compact
    ? { dateStyle: 'medium' }
    : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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
    if (parcel.lastVisitedAt) {
      const visit = document.createElement('span');
      visit.className = 'parcel-visit-summary';
      visit.textContent = `Last visited ${formatVisit(parcel.lastVisitedAt, true)}`;
      copy.append(visit);
    }
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

function toggleMapLayer() {
  if (!map) return;
  satelliteView = !satelliteView;
  if (satelliteView) {
    map.removeLayer(streetLayer);
    satelliteLayer.addTo(map);
    satelliteLabelsLayer.addTo(map);
  } else {
    map.removeLayer(satelliteLabelsLayer);
    map.removeLayer(satelliteLayer);
    streetLayer.addTo(map);
  }
  document.getElementById('toggleMapLayer').textContent = satelliteView ? 'Map' : 'Satellite';
  document.getElementById('toggleMapLayer').setAttribute('aria-label',
    satelliteView ? 'Switch to road map' : 'Switch to satellite view');
  document.getElementById('toggleMapLayer').setAttribute('aria-pressed', String(satelliteView));
  elements.roadAttribution.classList.toggle('hidden', satelliteView);
  elements.satelliteAttribution.classList.toggle('hidden', !satelliteView);
}

function showToast(message) {
  elements.gpsToast.textContent = message;
  elements.gpsToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.gpsToast.classList.add('hidden'), 4200);
}

function showSearchResults(results) {
  const container = elements.locationSearchResults;
  container.replaceChildren();
  results.forEach((result) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.role = 'option';
    button.className = 'search-result';
    button.textContent = result.display_name;
    button.addEventListener('click', () => selectSearchResult(result));
    container.append(button);
  });
  container.classList.remove('hidden');
  elements.locationSearchInput.setAttribute('aria-expanded', 'true');
}

function showSearchMessage(message) {
  const container = elements.locationSearchResults;
  container.replaceChildren();
  const item = document.createElement('div');
  item.className = 'search-result search-result-message';
  item.textContent = message;
  container.append(item);
  container.classList.remove('hidden');
  elements.locationSearchInput.setAttribute('aria-expanded', 'true');
}

function hideSearchResults() {
  elements.locationSearchResults.replaceChildren();
  elements.locationSearchResults.classList.add('hidden');
  elements.locationSearchInput.setAttribute('aria-expanded', 'false');
}

function selectSearchResult(result) {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    showToast('That search result did not include valid coordinates.');
    return;
  }
  const point = [latitude, longitude];
  map.setView(point, Math.max(map.getZoom(), 16));
  if (searchMarker) map.removeLayer(searchMarker);
  const icon = L.divIcon({
    className: '',
    html: '<div class="search-place-marker"></div>',
    iconSize: [22, 22],
    iconAnchor: [11, 20]
  });
  searchMarker = L.marker(point, { icon }).addTo(map);
  const popup = document.createElement('span');
  popup.textContent = result.display_name;
  searchMarker.bindPopup(popup);
  elements.locationSearchInput.value = result.display_name;
  hideSearchResults();
}

async function searchLocation(event) {
  event.preventDefault();
  if (searchInProgress) return;
  const query = elements.locationSearchInput.value.trim();
  if (query.length < 2) {
    showSearchMessage('Enter at least two characters to search.');
    return;
  }

  searchInProgress = true;
  const button = elements.locationSearchForm.querySelector('[type="submit"]');
  button.disabled = true;
  showSearchMessage('Searching places…');
  try {
    const wait = Math.max(0, 1000 - (Date.now() - lastLocationSearchAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastLocationSearchAt = Date.now();
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('q', query);
    const response = await fetch(url, {
      headers: { 'Accept-Language': navigator.language || 'en' }
    });
    if (!response.ok) {
      throw new Error(`Location search failed (HTTP ${response.status}). Try again later.`);
    }
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0) {
      showSearchMessage('No matching places found. Try a town, landmark, or address.');
      return;
    }
    showSearchResults(results);
  } catch (error) {
    console.error('Location search failed.', error);
    const message = error instanceof TypeError
      ? 'Location search needs an internet connection.'
      : error.message;
    showSearchMessage(message);
  } finally {
    searchInProgress = false;
    button.disabled = false;
  }
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
  pendingDeedPhoto = '';
  document.getElementById('deedPhotoInput').value = '';
  document.getElementById('parcelDocumentInput').value = '';
  showSelectedDocuments([]);
  document.getElementById('newDeedPhotoPreview').classList.add('hidden');
  elements.parcelDialog.showModal();
  elements.parcelForm.elements.name.focus();
}

async function compressDeedPhoto(file) {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 20 MB.');
  }

  let image;
  let releaseImage = () => {};
  if (window.createImageBitmap) {
    image = await createImageBitmap(file);
    releaseImage = () => image.close();
  } else {
    const objectUrl = URL.createObjectURL(file);
    image = new Image();
    releaseImage = () => URL.revokeObjectURL(objectUrl);
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The selected image could not be opened.'));
        image.src = objectUrl;
      });
    } catch (error) {
      releaseImage();
      throw error;
    }
  }

  try {
    const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the selected image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.76);
  } finally {
    releaseImage();
  }
}

async function chooseNewDeedPhoto(event) {
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;
  try {
    pendingDeedPhoto = await compressDeedPhoto(file);
    document.getElementById('newDeedPhotoImage').src = pendingDeedPhoto;
    document.getElementById('newDeedPhotoPreview').classList.remove('hidden');
    showToast('Deed photo added. It will be saved on this device.');
  } catch (error) {
    console.error('Could not prepare the title deed photo.', error);
    showToast(error.message || 'Could not read that photo. Choose a JPG or PNG image.');
  } finally {
    input.value = '';
  }
}

async function updateDeedPhoto(event) {
  const input = event.currentTarget;
  const file = input.files[0];
  const parcelId = activeParcelId;
  if (!file || !parcelId) return;
  try {
    const photo = await compressDeedPhoto(file);
    const parcel = parcels.find((item) => item.id === parcelId);
    if (!parcel) return;
    const previousPhoto = parcel.deedPhoto;
    parcel.deedPhoto = photo;
    if (!persistParcels()) {
      if (previousPhoto === undefined) delete parcel.deedPhoto;
      else parcel.deedPhoto = previousPhoto;
      return;
    }
    openParcelDetails(parcelId);
    showToast('Title deed photo saved on this device.');
  } catch (error) {
    console.error('Could not save the title deed photo.', error);
    showToast(error.message || 'Could not read that photo. Choose a JPG or PNG image.');
  } finally {
    input.value = '';
  }
}

async function saveParcel(event) {
  event.preventDefault();
  if (savingParcel) return;
  const files = Array.from(document.getElementById('parcelDocumentInput').files);
  try {
    validateDocuments(files);
  } catch (error) {
    showToast(error.message);
    return;
  }

  savingParcel = true;
  const submitButton = elements.parcelForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const createdDocumentIds = [];
  try {
    const documents = await saveDocumentFiles(files, createdDocumentIds);
    const form = new FormData(elements.parcelForm);
    const parcel = {
      id: createRecordId(),
      name: String(form.get('name') || '').trim(),
      county: String(form.get('county') || '').trim(),
      deedNumber: String(form.get('deedNumber') || '').trim(),
      deedPhoto: pendingDeedPhoto,
      documents,
      notes: String(form.get('notes') || '').trim(),
      points: draftPoints.map(([latitude, longitude]) => [latitude, longitude]),
      createdAt: new Date().toISOString()
    };
    if (!parcel.name || parcel.points.length < 3) {
      await cleanupDocumentFiles(createdDocumentIds);
      return;
    }
    parcels.unshift(parcel);
    if (!persistParcels()) {
      parcels.shift();
      await cleanupDocumentFiles(createdDocumentIds);
      return;
    }
    renderParcels();
    elements.parcelDialog.close();
    elements.parcelForm.reset();
    pendingDeedPhoto = '';
    showSelectedDocuments([]);
    draftPoints = [];
    draftLayer.clearLayers();
    elements.mappingPanel.classList.add('hidden');
    elements.mapHeading.textContent = 'Your land, at a glance.';
    elements.mapSubheading.textContent = 'Your parcel is saved on this device.';
    const layer = savedLayers.get(parcel.id);
    if (layer) map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 17 });
    showToast('Parcel saved on this device.');
  } catch (error) {
    await cleanupDocumentFiles(createdDocumentIds);
    console.error('Could not save parcel and attached documents.', error);
    showToast(`Could not save parcel: ${error.message || 'Check available device storage.'}`);
  } finally {
    savingParcel = false;
    submitButton.disabled = false;
  }
}

function openParcelDetails(id) {
  const parcel = parcels.find((item) => item.id === id);
  if (!parcel) return;
  activeParcelId = id;
  document.getElementById('detailsName').textContent = parcel.name;
  document.getElementById('detailsCounty').textContent = parcel.county || 'Not added';
  document.getElementById('detailsArea').textContent = parcelArea(parcel);
  document.getElementById('detailsDeed').textContent = parcel.deedNumber || 'Not added';
  const photoPreview = document.getElementById('detailsDeedPhotoPreview');
  const photoImage = document.getElementById('detailsDeedPhotoImage');
  const photoEmpty = document.getElementById('detailsPhotoEmpty');
  photoImage.src = parcel.deedPhoto || '';
  photoPreview.classList.toggle('hidden', !parcel.deedPhoto);
  photoEmpty.classList.toggle('hidden', Boolean(parcel.deedPhoto));
  document.getElementById('detailsLastVisited').textContent = parcel.lastVisitedAt
    ? formatVisit(parcel.lastVisitedAt)
    : 'Not recorded yet';
  document.getElementById('detailsPoints').textContent = `${parcel.points.length} GPS points`;
  document.getElementById('detailsNotes').textContent = parcel.notes || 'No notes';
  renderDocumentList(parcel);
  if (!elements.detailsDialog.open) elements.detailsDialog.showModal();
}

function selectParcelDocuments(event) {
  const files = Array.from(event.currentTarget.files);
  showSelectedDocuments(files);
  try {
    validateDocuments(files);
  } catch (error) {
    showToast(error.message);
  }
}

async function addParcelDocuments(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files);
  const parcelId = activeParcelId;
  if (files.length === 0 || !parcelId) return;
  const createdDocumentIds = [];
  try {
    validateDocuments(files);
    const parcel = parcels.find((item) => item.id === parcelId);
    if (!parcel) return;
    const previousDocuments = Array.isArray(parcel.documents) ? parcel.documents : [];
    const addedDocuments = await saveDocumentFiles(files, createdDocumentIds);
    parcel.documents = previousDocuments.concat(addedDocuments);
    if (!persistParcels()) {
      parcel.documents = previousDocuments;
      await cleanupDocumentFiles(createdDocumentIds);
      return;
    }
    openParcelDetails(parcelId);
    showToast(`${addedDocuments.length} document${addedDocuments.length === 1 ? '' : 's'} saved on this device.`);
  } catch (error) {
    await cleanupDocumentFiles(createdDocumentIds);
    console.error('Could not attach documents to parcel.', error);
    showToast(`Could not attach documents: ${error.message || 'Check available device storage.'}`);
  } finally {
    input.value = '';
  }
}

function recordParcelVisit() {
  const parcel = parcels.find((item) => item.id === activeParcelId);
  if (!parcel) return;
  const previousVisit = parcel.lastVisitedAt;
  parcel.lastVisitedAt = new Date().toISOString();
  if (!persistParcels()) {
    if (previousVisit === undefined) delete parcel.lastVisitedAt;
    else parcel.lastVisitedAt = previousVisit;
    return;
  }
  renderParcels();
  openParcelDetails(parcel.id);
  showToast('Visit recorded on this device.');
}

function viewActiveParcel() {
  const layer = savedLayers.get(activeParcelId);
  if (layer) {
    elements.detailsDialog.close();
    map.fitBounds(layer.getBounds(), { padding: [70, 70], maxZoom: 17 });
  }
}

async function deleteActiveParcel() {
  const parcel = parcels.find((item) => item.id === activeParcelId);
  if (!parcel || !window.confirm(`Delete "${parcel.name}" from this device? This cannot be undone.`)) return;
  parcels = parcels.filter((item) => item.id !== activeParcelId);
  if (!persistParcels()) {
    parcels.unshift(parcel);
    return;
  }
  let documentCleanupFailed = false;
  for (const record of Array.isArray(parcel.documents) ? parcel.documents : []) {
    try {
      await deleteDocumentFile(record.id);
    } catch (error) {
      documentCleanupFailed = true;
      console.error('Could not remove an attached document after parcel deletion.', error);
    }
  }
  renderParcels();
  elements.detailsDialog.close();
  showToast(documentCleanupFailed
    ? 'Parcel deleted, but some attached documents could not be removed from device storage.'
    : 'Parcel deleted from this device.');
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
document.getElementById('toggleMapLayer').addEventListener('click', toggleMapLayer);
elements.locationSearchForm.addEventListener('submit', searchLocation);
elements.locationSearchInput.addEventListener('input', hideSearchResults);
elements.locationSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideSearchResults();
});
document.getElementById('zoomIn').addEventListener('click', () => map && map.zoomIn());
document.getElementById('zoomOut').addEventListener('click', () => map && map.zoomOut());
document.getElementById('viewParcel').addEventListener('click', viewActiveParcel);
document.getElementById('deleteParcel').addEventListener('click', deleteActiveParcel);
document.getElementById('recordVisit').addEventListener('click', recordParcelVisit);
elements.parcelForm.addEventListener('submit', saveParcel);
document.getElementById('deedPhotoInput').addEventListener('change', chooseNewDeedPhoto);
document.getElementById('detailsDeedPhotoInput').addEventListener('change', updateDeedPhoto);
document.getElementById('parcelDocumentInput').addEventListener('change', selectParcelDocuments);
document.getElementById('detailsDocumentInput').addEventListener('change', addParcelDocuments);
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
