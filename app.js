const STORAGE_KEY = 'my-place-map-places-v1';
let places = loadPlaces();
let currentLocation = null;
let activeFilter = 'all';

const els = {
  markers: document.getElementById('markers'),
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
  const x = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2;
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
    .sort((a,b) => {
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      return b.createdAt - a.createdAt;
    });
}

function render() {
  const data = filteredPlaces();
  els.countText.textContent = `${data.length} địa điểm`;
  els.markers.innerHTML = '';
  els.placeList.innerHTML = '';

  if (!data.length) {
    els.placeList.innerHTML = '<div class="empty">Chưa có địa điểm phù hợp. Bấm <b>＋ Thêm địa điểm</b> để bắt đầu.</div>';
    return;
  }

  // This first version uses a relative visualization rather than a real tile map.
  // Coordinates remain stored accurately for later Google Maps/Mapbox integration.
  data.forEach((p, i) => {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'marker';
    marker.style.left = `${18 + ((i * 29) % 70)}%`;
    marker.style.top = `${25 + ((i * 37) % 58)}%`;
    marker.title = p.name;
    const icon = categoryInfo[p.category]?.icon || '📌';
    marker.innerHTML = `<div class="marker-dot"><span>${icon}</span></div><div class="marker-label">${escapeHtml(p.name)}</div>`;
    marker.addEventListener('click', () => scrollToCard(p.id));
    els.markers.appendChild(marker);

    const card = document.createElement('article');
    card.className = 'place-card';
    card.id = `place-${p.id}`;
    const metaDistance = p.distance == null ? 'Chưa xác định khoảng cách' : `${p.distance.toFixed(1)} km từ bạn`;
    const want = p.want ? '<span class="badge">❤️ Muốn đi</span>' : '';
    card.innerHTML = `
      <div class="place-title">${icon} ${escapeHtml(p.name)}</div>
      <div class="place-meta">${categoryInfo[p.category]?.label || 'Khác'} · ${metaDistance}</div>
      ${p.note ? `<div class="place-note">${escapeHtml(p.note)}</div>` : ''}
      ${want}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button type="button" class="secondary open-map" data-lat="${p.lat}" data-lng="${p.lng}">🧭 Mở bản đồ</button>
        <button type="button" class="secondary delete-place" data-id="${p.id}">Xóa</button>
      </div>`;
    els.placeList.appendChild(card);
  });

  els.placeList.querySelectorAll('.delete-place').forEach(btn => {
    btn.addEventListener('click', () => {
      places = places.filter(p => p.id !== btn.dataset.id);
      savePlaces();
      render();
    });
  });

  els.placeList.querySelectorAll('.open-map').forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = Number(btn.dataset.lat);
      const lng = Number(btn.dataset.lng);
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`, '_blank', 'noopener');
    });
  });
}

function scrollToCard(id) {
  const card = document.getElementById(`place-${id}`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function useLocation() {
  if (!navigator.geolocation) {
    els.mapHint.textContent = 'Trình duyệt không hỗ trợ định vị. Bạn có thể nhập tọa độ khi thêm địa điểm.';
    return;
  }
  els.locate.disabled = true;
  els.locate.textContent = '⌛ Đang định vị...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      currentLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      els.mapHint.textContent = `📍 Đã lấy vị trí hiện tại (${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}).`;
      els.locate.disabled = false;
      els.locate.textContent = '📍 Vị trí của tôi';
      if (!els.lat.value) els.lat.value = currentLocation.lat.toFixed(6);
      if (!els.lng.value) els.lng.value = currentLocation.lng.toFixed(6);
      render();
    },
    () => {
      els.mapHint.textContent = 'Không lấy được vị trí. Kiểm tra quyền Location của trình duyệt.';
      els.locate.disabled = false;
      els.locate.textContent = '📍 Vị trí của tôi';
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
}

els.locate.addEventListener('click', useLocation);
els.radius.addEventListener('change', render);
els.add.addEventListener('click', () => {
  els.error.textContent = '';
  els.name.value = '';
  els.note.value = '';
  els.lat.value = currentLocation ? currentLocation.lat.toFixed(6) : '';
  els.lng.value = currentLocation ? currentLocation.lng.toFixed(6) : '';
  els.want.checked = false;
  els.category.value = 'food';
  els.dialog.showModal();
});

els.form.addEventListener('submit', event => {
  event.preventDefault();
  const lat = Number(els.lat.value);
  const lng = Number(els.lng.value);
  if (!els.name.value.trim()) { els.error.textContent = 'Hãy nhập tên địa điểm.'; return; }
  if (!validCoord(lat, lng)) { els.error.textContent = 'Vĩ độ / kinh độ chưa hợp lệ. Hãy nhập đúng tọa độ.'; return; }
  places.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: els.name.value.trim(),
    category: els.category.value,
    note: els.note.value.trim(),
    lat, lng,
    want: els.want.checked,
    createdAt: Date.now()
  });
  savePlaces();
  els.dialog.close();
  render();
});

document.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
  chip.classList.add('active');
  activeFilter = chip.dataset.filter;
  render();
}));

render();
// Attempt to locate on first open. Browser permission may be required.
useLocation();
