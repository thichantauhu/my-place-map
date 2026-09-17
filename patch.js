(() => {
  const addressInput = document.getElementById('addressInput');
  const searchBtn = document.getElementById('searchAddressBtn');
  const resultsBox = document.getElementById('addressResults');
  const dialog = document.getElementById('placeDialog');
  const coordInput = document.getElementById('coordInput');
  const latInput = document.getElementById('latInput');
  const lngInput = document.getElementById('lngInput');
  const selectedLocation = document.getElementById('selectedLocation');
  const error = document.getElementById('formError');
  const mapHint = document.getElementById('mapHint');
  const nameInput = document.getElementById('nameInput');
  const noteInput = document.getElementById('noteInput');
  const categoryInput = document.getElementById('categoryInput');
  const wantInput = document.getElementById('wantInput');
  const radiusSelect = document.getElementById('radiusSelect');
  const pickerOverlay = document.getElementById('pickerOverlay');
  const pickerCoords = document.getElementById('pickerCoords');
  const STORAGE_KEY = 'my-place-map-places-v2';

  let sessionToken = null;
  let pickerMap = null;
  let pickerMarker = null;
  let pickerPosition = null;

  const validCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  function parseCoordText(text) {
    const value = String(text || '').trim().replace(/[\u00a0\s]+/g, ' ');
    if (!value) return null;
    const match = value.match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    return validCoord(lat, lng) ? { lat, lng } : null;
  }

  function syncCoordFields(lat, lng) {
    if (!validCoord(lat, lng)) return false;
    latInput.value = String(lat);
    lngInput.value = String(lng);
    coordInput.value = `${String(lat)}, ${String(lng)}`;
    selectedLocation.textContent = `📍 Đã chọn: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    return true;
  }

  function readCoordInputs() {
    const combined = parseCoordText(coordInput.value);
    if (combined) {
      syncCoordFields(combined.lat, combined.lng);
      return combined;
    }
    const latText = latInput.value.trim();
    const lngText = lngInput.value.trim();
    if (!latText || !lngText) return null;
    const lat = Number(latText), lng = Number(lngText);
    return validCoord(lat, lng) ? { lat, lng } : null;
  }

  const token = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  if (sessionStorage.getItem('my-place-map-show-all') === '1') {
    sessionStorage.removeItem('my-place-map-show-all');
    radiusSelect.value = '999';
    radiusSelect.dispatchEvent(new Event('change'));
  }

  async function api(path, params = {}) {
    const url = new URL(path, location.origin);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'API error'), { code: data.error, status: res.status });
    return data;
  }

  async function placeApi(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: {'Content-Type': 'application/json', Accept: 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'Places API error'), { code: data.error, status: res.status });
    return data;
  }

  function normalizePlace(p) {
    return {
      id: String(p.id), name: String(p.name || ''), address: String(p.address || ''),
      category: String(p.category || 'food'), note: String(p.note || ''),
      lat: Number(p.lat), lng: Number(p.lng), want: Boolean(p.want),
      createdAt: Number(p.createdAt ?? p.created_at ?? Date.now())
    };
  }

  async function syncRemotePlaces() {
    try {
      const data = await api('/api/places');
      const remote = Array.isArray(data.places) ? data.places.map(normalizePlace) : [];
      let local = [];
      try { local = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').map(normalizePlace); } catch (_) {}

      if (remote.length > 0) {
        const remoteJson = JSON.stringify(remote);
        const localJson = JSON.stringify(local);
        if (remoteJson !== localJson) {
          localStorage.setItem(STORAGE_KEY, remoteJson);
          sessionStorage.setItem('my-place-map-show-all', '1');
          location.reload();
        }
        return;
      }

      // First connection: migrate existing local places into Supabase.
      if (local.length > 0) {
        for (const place of local) {
          try { await placeApi('POST', '/api/places', place); } catch (_) { return; }
        }
      }
    } catch (_) {
      // Keep localStorage working as a fallback if Supabase is unavailable.
    }
  }

  syncRemotePlaces();

  async function nominatimSearch(q) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '8');
    url.searchParams.set('countrycodes', 'vn');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('q', q);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Nominatim error');
    return res.json();
  }

  function clearResults() { resultsBox.innerHTML = ''; }

  function renderResult(mainText, secondaryText, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'address-result';
    const main = document.createElement('strong');
    main.textContent = mainText || 'Địa chỉ';
    btn.appendChild(main);
    if (secondaryText) {
      const sub = document.createElement('span');
      sub.textContent = secondaryText;
      btn.appendChild(sub);
    }
    btn.addEventListener('click', onClick);
    resultsBox.appendChild(btn);
  }

  async function searchAddressNew() {
    const q = addressInput.value.trim();
    error.textContent = '';
    clearResults();
    if (!q) { error.textContent = 'Hãy nhập địa chỉ cần tìm.'; return; }
    searchBtn.disabled = true;
    searchBtn.textContent = '⌛ Đang tìm...';
    sessionToken = token();
    try {
      let data;
      try {
        data = await api('/api/address-search', { q, sessionToken });
      } catch (_) {
        const results = await nominatimSearch(q);
        data = { source: 'nominatim', predictions: results.map(r => ({ text: r.display_name, mainText: r.display_name, secondaryText: '', lat: Number(r.lat), lng: Number(r.lon) })) };
      }

      if (!data.predictions?.length) {
        resultsBox.innerHTML = '<div class="address-no-result">Không tìm thấy địa chỉ này. Nếu m có tọa độ Google Maps thì dán vào ô “Vĩ độ, Kinh độ” bên dưới để chọn chính xác.</div>';
        return;
      }

      data.predictions.forEach(p => {
        renderResult(p.mainText || p.text, p.secondaryText || (p.mainText !== p.text ? p.text : ''), async () => {
          if (data.source === 'gogoduk') {
            addressInput.value = p.text || p.mainText || '';
            selectedLocation.textContent = '⌛ Đang lấy tọa độ chính xác...';
            try {
              const resolved = await api('/api/address-resolve', { id: p.placeId, sessionToken });
              const place = resolved.place || {};
              const lat = Number(place.lat), lng = Number(place.lng);
              if (!validCoord(lat, lng)) throw new Error('Invalid coordinates');
              addressInput.value = place.address || p.text || '';
              syncCoordFields(lat, lng);
              window.__myPlaceMapSetView?.(lat, lng);
              mapHint.textContent = '📍 Đã chọn địa chỉ. Tọa độ lấy từ GoGoDuk.';
              clearResults();
            } catch (_) {
              selectedLocation.textContent = 'Chưa chọn vị trí chính xác';
              error.textContent = 'Không lấy được tọa độ. M có thể dán tọa độ Google Maps vào ô “Vĩ độ, Kinh độ” hoặc chọn trên bản đồ.';
            }
          } else {
            const lat = Number(p.lat), lng = Number(p.lng);
            if (!validCoord(lat, lng)) return;
            addressInput.value = p.text || '';
            syncCoordFields(lat, lng);
            window.__myPlaceMapSetView?.(lat, lng);
            mapHint.textContent = '📍 Kết quả từ OpenStreetMap; có thể chưa đúng số nhà.';
            clearResults();
          }
        });
      });
    } catch (_) {
      error.textContent = 'Không thể tìm địa chỉ lúc này. M vẫn có thể dán tọa độ Google Maps vào ô “Vĩ độ, Kinh độ”.';
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = '🔎 Tìm địa chỉ';
    }
  }

  function setPickerPosition(lat, lng) {
    if (!validCoord(lat, lng)) return;
    pickerPosition = { lat, lng };
    if (pickerMarker) pickerMarker.setLatLng([lat, lng]);
    else {
      pickerMarker = L.marker([lat, lng], { draggable: true }).addTo(pickerMap);
      pickerMarker.on('dragend', () => {
        const p = pickerMarker.getLatLng();
        setPickerPosition(p.lat, p.lng);
      });
    }
    pickerCoords.textContent = `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  function openPickerNew() {
    error.textContent = '';
    dialog.close();
    pickerOverlay.hidden = false;
    const explicit = readCoordInputs();
    const mainCenter = window.__myPlaceMapMain?.getCenter?.();
    pickerPosition = explicit || (mainCenter ? { lat: mainCenter.lat, lng: mainCenter.lng } : { lat: 10.7769, lng: 106.7009 });
    if (!pickerMap) {
      pickerMap = L.map('pickerMap', { zoomControl: true }).setView([pickerPosition.lat, pickerPosition.lng], 17);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap contributors' }).addTo(pickerMap);
      pickerMap.on('click', e => setPickerPosition(e.latlng.lat, e.latlng.lng));
    }
    setTimeout(() => {
      pickerMap.invalidateSize();
      pickerMap.setView([pickerPosition.lat, pickerPosition.lng], 18);
      setPickerPosition(pickerPosition.lat, pickerPosition.lng);
    }, 120);
  }

  function reopenDialog() {
    pickerOverlay.hidden = true;
    if (!dialog.open) dialog.showModal();
  }

  async function confirmPickerNew() {
    if (!pickerPosition || !validCoord(pickerPosition.lat, pickerPosition.lng)) {
      pickerCoords.textContent = '⚠️ Hãy bấm lên bản đồ để chọn vị trí.';
      return;
    }
    const { lat, lng } = pickerPosition;
    syncCoordFields(lat, lng);
    try {
      const data = await api('/api/address-reverse', { lat, lng });
      if (data.address) addressInput.value = data.address;
    } catch (_) {
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`, { headers: { Accept: 'application/json' } });
        const d = await r.json();
        if (d.display_name) addressInput.value = d.display_name;
      } catch (_) {}
    }
    reopenDialog();
    mapHint.textContent = '🎯 Đã chọn vị trí chính xác. Bấm Lưu địa điểm để hoàn tất.';
  }

  function openAddDialogSafe(lat = null, lng = null) {
    error.textContent = '';
    clearResults();
    nameInput.value = '';
    addressInput.value = '';
    noteInput.value = '';
    coordInput.value = '';
    latInput.value = '';
    lngInput.value = '';
    selectedLocation.textContent = 'Chưa chọn vị trí chính xác';
    wantInput.checked = false;
    categoryInput.value = 'food';
    if (validCoord(lat, lng)) syncCoordFields(lat, lng);
    dialog.showModal();
    setTimeout(() => nameInput.focus(), 50);
  }

  document.addEventListener('click', e => {
    if (e.target.closest('#addBtn')) {
      e.preventDefault(); e.stopImmediatePropagation();
      openAddDialogSafe();
    }
  }, true);

  document.addEventListener('click', e => {
    if (e.target.closest('#searchAddressBtn')) { e.preventDefault(); e.stopImmediatePropagation(); searchAddressNew(); }
    else if (e.target.closest('#pickLocationBtn')) { e.preventDefault(); e.stopImmediatePropagation(); openPickerNew(); }
    else if (e.target.closest('#closePickerBtn')) { e.preventDefault(); e.stopImmediatePropagation(); reopenDialog(); }
    else if (e.target.closest('#confirmPickerBtn')) { e.preventDefault(); e.stopImmediatePropagation(); confirmPickerNew(); }
  }, true);

  coordInput.addEventListener('input', () => {
    const parsed = parseCoordText(coordInput.value);
    if (parsed) {
      syncCoordFields(parsed.lat, parsed.lng);
      error.textContent = '';
    }
  });

  document.addEventListener('submit', async e => {
    if (e.target?.id !== 'placeForm') return;
    e.preventDefault(); e.stopImmediatePropagation();
    error.textContent = '';
    const name = nameInput.value.trim();
    const coords = readCoordInputs();
    if (!name) { error.textContent = 'Hãy nhập tên địa điểm.'; return; }
    if (!coords) { error.textContent = 'Hãy dán tọa độ theo dạng: Vĩ độ, Kinh độ (ví dụ 10.800829838769747, 106.68482208597538).'; return; }

    let places = [];
    try { places = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) { places = []; }
    const address = addressInput.value.trim();
    const duplicate = places.some(p => p.name.trim().toLowerCase() === name.toLowerCase() && Math.abs(Number(p.lat) - coords.lat) < 1e-12 && Math.abs(Number(p.lng) - coords.lng) < 1e-12 && String(p.address || '').trim() === address);
    if (duplicate) { error.textContent = 'Địa điểm này đã tồn tại.'; return; }

    const place = normalizePlace({
      id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      name, address, category: categoryInput.value, note: noteInput.value.trim(),
      lat: coords.lat, lng: coords.lng, want: wantInput.checked, createdAt: Date.now()
    });

    // Supabase is the primary persistent store. Only close after it succeeds.
    try {
      await placeApi('POST', '/api/places', place);
    } catch (_) {
      error.textContent = '⚠️ Chưa sao lưu được địa điểm lên máy chủ. Kiểm tra kết nối rồi bấm Lưu lại.';
      return;
    }

    places.push(place);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(places));
    sessionStorage.setItem('my-place-map-show-all', '1');
    dialog.close();
    location.reload();
  }, true);

  document.addEventListener('click', async e => {
    const deleteBtn = e.target.closest('.delete-place');
    if (!deleteBtn) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const id = deleteBtn.dataset.id;
    try {
      await placeApi('DELETE', `/api/places/${encodeURIComponent(id)}`);
      let places = [];
      try { places = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) {}
      localStorage.setItem(STORAGE_KEY, JSON.stringify(places.filter(p => String(p.id) !== String(id))));
      location.reload();
    } catch (_) {
      alert('Không thể xóa khỏi bộ nhớ máy chủ. Vui lòng thử lại.');
    }
  }, true);

  document.addEventListener('click', e => {
    const card = e.target.closest('.place-card');
    if (!card || e.target.closest('button, a, input, select, textarea')) return;
    const id = card.id?.replace(/^place-/, '');
    let places = [];
    try { places = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) {}
    const place = places.find(p => p.id === id);
    if (place && window.__myPlaceMapMain) window.__myPlaceMapMain.setView([place.lat, place.lng], Math.max(window.__myPlaceMapMain.getZoom(), 16), { animate: true });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target === addressInput) { e.preventDefault(); e.stopImmediatePropagation(); searchAddressNew(); }
  }, true);
})();
