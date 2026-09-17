const STORAGE_KEY = 'my-place-map-places-v2';
let places = loadPlaces();
let currentLocation = null;
let activeFilter = 'all';
let map;
let userMarker;
let userAccuracy;
let placeMarkers = new Map();

const els = {
  placeList: document.getElementById('placeList'),
  countText: document.getElementById('countText'),
  radius: document.getElementById('radiusSelect'),
  locate: document.getElementById('locateBtn'),
  add: document.getElementById('addBtn'),
  dialog: document.getElementById('placeDialog'),
  form: document.getElementById('placeForm'),
  name: document.getElementById('nameInput'),
  category: document.getElementById('categoryInput'),
  note: document.getElementById('noteInput'),
  lat: document.getElementById('latInput'),
  lng: document.getElementById('lngInput'),
  want: document.getElementById('wantInput'),
  error: document.getElementById('formError'),
  mapHint: document.getElementById('mapHint')
};

const categoryInfo = {
  food: { icon: '🍜', label: 'Ăn uống' },
  fun: { icon: '🎮', label: 'Vui chơi' },
  cafe: { icon: '☕', label: 'Cafe' },
  other: { icon: '📌', label: 'Khác' }
};

function loadPlaces() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function savePlaces() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
}

function validCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const p1 = aLat * Math.PI / 180;
  const p2 = bLat * Math.PI / 180;
  const dp = (bLat - aLat) * Math.PI / 180;
  const dl = (bLng - aLng) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function filteredPlaces() {
  const radius = Number(els.radius.value);
  return places
    .map(p => ({ ...p, distance: currentLocation ? distanceKm(currentLocation.lat, currentLocation.lng, p.lat, p.lng) : null }))
    .filter(p => {
      if (activeFilter === 'want' && !p.want) return false;
      if (['food', 'fun', 'cafe'].includes(activeFilter) && p.category !== activeFilter) return false;
      if (currentLocation && radius < 999 && p.distance > radius) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      return b.createdAt - a.createdAt;
    });
}

function initMap() {
  // Vietnam is only the temporary fallback center. The app immediately asks for the user's location.
  map = L.map('map', { zoomControl: true }).setView([10.7769, 106.7009], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  map.on('click', event => {
    openAddDialog(event.latlng.lat, event.latlng.lng);
  });
}

function renderMarkers(data) {
  placeMarkers.forEach(marker => marker.remove());
  placeMarkers.clear();

  data.forEach(p => {
    const icon = categoryInfo[p.category]?.icon || '📌';
    const marker = L.marker([p.lat, p.lng]).addTo(map);
    marker.bindPopup(`
      <div class="popup">
        <strong>${icon} ${escapeHtml(p.name)}</strong>
        <div>${escapeHtml(categoryInfo[p.category]?.label || 'Khác')}</div>
        ${p.note ? `<p>${escapeHtml(p.note)}</p>` : ''}
        ${p.want ? '<span>❤️ Muốn đi</span>' : ''}
        <br><button class="popup-direction" data-lat="${p.lat}" data-lng="${p.lng}">🧭 Chỉ đường</button>
      </div>
    `);
    marker.on('popupopen', event => {
      const btn = event.popup.getElement()?.querySelector('.popup-direction');
      if (btn) btn.addEventListener('click', () => openDirections(Number(btn.dataset.lat), Number(btn.dataset.lng)));
    });
    placeMarkers.set(p.id, marker);
  });
}

function render() {
  const data = filteredPlaces();
  els.countText.textContent = `${data.length} địa điểm`;
  els.placeList.innerHTML = '';
  renderMarkers(data);

  if (!data.length) {
    els.placeList.innerHTML = '<div class="empty">Chưa có địa điểm phù hợp. Bấm <b>＋ Thêm địa điểm</b> hoặc bấm một điểm trên bản đồ để lưu.</div>';
    return;
  }

  data.forEach(p => {
    const icon = categoryInfo[p.category]?.icon || '📌';
    const metaDistance = p.distance == null ? 'Chưa xác định khoảng cách' : `${p.distance.toFixed(1)} km từ bạn`;
    const want = p.want ? '<span class="badge">❤️ Muốn đi</span>' : '';
    const card = document.createElement('article');
    card.className = 'place-card';
    card.id = `place-${p.id}`;
    card.innerHTML = `
      <div class="place-title">${icon} ${escapeHtml(p.name)}</div>
      <div class="place-meta">${escapeHtml(categoryInfo[p.category]?.label || 'Khác')} · ${metaDistance}</div>
      ${p.note ? `<div class="place-note">${escapeHtml(p.note)}</div>` : ''}
      ${want}
      <div class="card-actions">
        <button type="button" class="secondary show-place" data-id="${p.id}">📍 Xem trên bản đồ</button>
        <button type="button" class="secondary open-map" data-lat="${p.lat}" data-lng="${p.lng}">🧭 Chỉ đường</button>
        <button type="button" class="secondary delete-place" data-id="${p.id}">Xóa</button>
      </div>`;
    els.placeList.appendChild(card);
  });

  els.placeList.querySelectorAll('.show-place').forEach(btn => btn.addEventListener('click', () => {
    const p = places.find(x => x.id === btn.dataset.id);
    if (!p) return;
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16), { animate: true });
    const marker = placeMarkers.get(p.id);
    if (marker) marker.openPopup();
  }));

  els.placeList.querySelectorAll('.delete-place').forEach(btn => btn.addEventListener('click', () => {
    places = places.filter(p => p.id !== btn.dataset.id);
    savePlaces();
    render();
  }));

  els.placeList.querySelectorAll('.open-map').forEach(btn => btn.addEventListener('click', () => {
    openDirections(Number(btn.dataset.lat), Number(btn.dataset.lng));
  }));
}

function openDirections(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`, '_blank', 'noopener');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function setCurrentLocation(lat, lng, accuracy = 0) {
  currentLocation = { lat, lng };

  if (userMarker) userMarker.setLatLng([lat, lng]);
  else {
    userMarker = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#fff',
      weight: 3,
      fillColor: '#1976d2',
      fillOpacity: 1
    }).addTo(map).bindTooltip('Vị trí của bạn');
  }

  if (userAccuracy > 0) userAccuracy.remove();
  if (accuracy > 0) {
    userAccuracy = L.circle([lat, lng], { radius: accuracy, color: '#1976d2', weight: 1, fillOpacity: 0.08 }).addTo(map);
  }

  map.setView([lat, lng], 15, { animate: true });
  els.mapHint.textContent = '📍 Đã xác định vị trí của bạn. Bấm lên bản đồ để thêm địa điểm.';
  els.locate.disabled = false;
  els.locate.textContent = '📍 Vị trí của tôi';
  render();
}

function useLocation() {
  if (!navigator.geolocation) {
    els.mapHint.textContent = 'Trình duyệt không hỗ trợ định vị. Bạn vẫn có thể dùng bản đồ và nhập tọa độ.';
    return;
  }
  els.locate.disabled = true;
  els.locate.textContent = '⌛ Đang định vị...';
  navigator.geolocation.getCurrentPosition(
    pos => setCurrentLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
    () => {
      els.mapHint.textContent = '⚠️ Chưa được cấp quyền vị trí. Hãy bật Location cho trang này rồi bấm “Vị trí của tôi”.';
      els.locate.disabled = false;
      els.locate.textContent = '📍 Vị trí của tôi';
      render();
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function openAddDialog(lat = null, lng = null) {
  els.error.textContent = '';
  els.name.value = '';
  els.note.value = '';
  els.lat.value = lat != null ? Number(lat).toFixed(6) : (currentLocation ? currentLocation.lat.toFixed(6) : '');
  els.lng.value = lng != null ? Number(lng).toFixed(6) : (currentLocation ? currentLocation.lng.toFixed(6) : '');
  els.want.checked = false;
  els.category.value = 'food';
  els.dialog.showModal();
  setTimeout(() => els.name.focus(), 50);
}

els.locate.addEventListener('click', useLocation);
els.radius.addEventListener('change', render);
els.add.addEventListener('click', () => openAddDialog());

els.form.addEventListener('submit', event => {
  event.preventDefault();
  const lat = Number(els.lat.value);
  const lng = Number(els.lng.value);
  if (!els.name.value.trim()) { els.error.textContent = 'Hãy nhập tên địa điểm.'; return; }
  if (!validCoord(lat, lng)) { els.error.textContent = 'Vĩ độ / kinh độ chưa hợp lệ.'; return; }

  places.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: els.name.value.trim(),
    category: els.category.value,
    note: els.note.value.trim(),
    lat,
    lng,
    want: els.want.checked,
    createdAt: Date.now()
  });
  savePlaces();
  els.dialog.close();
  render();

  const saved = places[places.length - 1];
  map.setView([saved.lat, saved.lng], 16, { animate: true });
  setTimeout(() => placeMarkers.get(saved.id)?.openPopup(), 350);
});

document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
  chip.classList.add('active');
  activeFilter = chip.dataset.filter;
  render();
}));

initMap();
render();
useLocation();
