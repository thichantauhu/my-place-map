(() => {
  const addressInput = document.getElementById('addressInput');
  const searchBtn = document.getElementById('searchAddressBtn');
  const resultsBox = document.getElementById('addressResults');
  const dialog = document.getElementById('placeDialog');
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

  let sessionToken = null;
  let pickerMap = null;
  let pickerMarker = null;
  let pickerPosition = null;

  // Empty inputs must NOT become 0,0. This was the cause of the picker opening at the Gulf of Guinea.
  const validCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  const readCoordInputs = () => {
    const latText = latInput.value.trim();
    const lngText = lngInput.value.trim();
    if (!latText || !lngText) return null;
    const lat = Number(latText), lng = Number(lngText);
    return validCoord(lat, lng) ? { lat, lng } : null;
  };
  const token = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

  async function api(path, params = {}) {
    const url = new URL(path, location.origin);
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'API error'), { code: data.error, status: res.status });
    return data;
  }

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
        // GoGoDuk can fail because of key/quota/upstream issues; always try OSM as a fallback.
        const results = await nominatimSearch(q);
        data = { source: 'nominatim', predictions: results.map(r => ({ text: r.display_name, mainText: r.display_name, secondaryText: '', lat: Number(r.lat), lng: Number(r.lon) })) };
      }

      if (!data.predictions?.length) {
        resultsBox.innerHTML = '<div class="address-no-result">Không tìm thấy địa chỉ này. Nếu m có vĩ độ/kinh độ thì nhập trực tiếp ở 2 ô bên dưới để lưu chính xác.</div>';
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
              latInput.value = lat.toFixed(6);
              lngInput.value = lng.toFixed(6);
              selectedLocation.textContent = `📍 Đã chọn: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
              window.__myPlaceMapSetView?.(lat, lng);
              mapHint.textContent = '📍 Đã chọn địa chỉ. Tọa độ lấy từ GoGoDuk.';
              clearResults();
            } catch (_) {
              selectedLocation.textContent = 'Chưa chọn vị trí chính xác';
              error.textContent = 'Không lấy được tọa độ. M có thể nhập vĩ độ/kinh độ trực tiếp hoặc chọn trên bản đồ.';
            }
          } else {
            const lat = Number(p.lat), lng = Number(p.lng);
            if (!validCoord(lat, lng)) return;
            addressInput.value = p.text || '';
            latInput.value = lat.toFixed(6);
            lngInput.value = lng.toFixed(6);
            selectedLocation.textContent = `📍 Đã chọn: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
            window.__myPlaceMapSetView?.(lat, lng);
            mapHint.textContent = '📍 Kết quả từ OpenStreetMap; có thể chưa đúng số nhà.';
            clearResults();
          }
        });
      });
    } catch (_) {
      error.textContent = 'Không thể tìm địa chỉ lúc này. M vẫn có thể nhập vĩ độ/kinh độ trực tiếp.';
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = '🔎 Tìm địa chỉ';
    }
  }

  function setPickerPosition(lat, lng) {
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
    document.getElementById('pickerOverlay').hidden = false;

    // Only use explicit coordinates. If none exist, use the current MAIN map center,
    // never Number('') => 0,0 and never the user's GPS position automatically.
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
    document.getElementById('pickerOverlay').hidden = true;
    if (!dialog.open) dialog.showModal();
  }

  async function confirmPickerNew() {
    if (!pickerPosition || !validCoord(pickerPosition.lat, pickerPosition.lng)) {
      pickerCoords.textContent = '⚠️ Hãy bấm lên bản đồ để chọn vị trí.';
      return;
    }
    const { lat, lng } = pickerPosition;
    latInput.value = lat.toFixed(6);
    lngInput.value = lng.toFixed(6);
    selectedLocation.textContent = `📍 Đã chọn chính xác: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
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

  function openAddDialogSafe() {
    error.textContent = '';
    clearResults();
    nameInput.value = '';
    addressInput.value = '';
    noteInput.value = '';
    latInput.value = '';
    lngInput.value = '';
    selectedLocation.textContent = 'Chưa chọn vị trí chính xác';
    wantInput.checked = false;
    categoryInput.value = 'food';
    dialog.showModal();
    setTimeout(() => nameInput.focus(), 50);
  }

  // Own the + button so the old app.js handler cannot reinsert current GPS coordinates.
  document.addEventListener('click', e => {
    if (e.target.closest('#addBtn')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openAddDialogSafe();
    }
  }, true);

  // Address search + picker handlers run before app.js handlers.
  document.addEventListener('click', e => {
    if (e.target.closest('#searchAddressBtn')) { e.preventDefault(); e.stopImmediatePropagation(); searchAddressNew(); }
    else if (e.target.closest('#pickLocationBtn')) { e.preventDefault(); e.stopImmediatePropagation(); openPickerNew(); }
    else if (e.target.closest('#closePickerBtn')) { e.preventDefault(); e.stopImmediatePropagation(); reopenDialog(); }
    else if (e.target.closest('#confirmPickerBtn')) { e.preventDefault(); e.stopImmediatePropagation(); confirmPickerNew(); }
  }, true);

  // Manual lat/lng must be a first-class save path. This capture handler prevents the old
  // submit handler from ever replacing the entered coordinates with current location.
  document.addEventListener('submit', e => {
    if (e.target?.id !== 'placeForm') return;
    e.preventDefault();
    e.stopImmediatePropagation();

    error.textContent = '';
    const name = nameInput.value.trim();
    const coords = readCoordInputs();
    if (!name) { error.textContent = 'Hãy nhập tên địa điểm.'; return; }
    if (!coords) { error.textContent = 'Hãy nhập đầy đủ Vĩ độ và Kinh độ, hoặc chọn vị trí trên bản đồ.'; return; }

    const raw = localStorage.getItem('my-place-map-places-v2');
    let places = [];
    try { places = raw ? JSON.parse(raw) : []; } catch (_) { places = []; }
    places.push({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      name,
      address: addressInput.value.trim(),
      category: categoryInput.value,
      note: noteInput.value.trim(),
      lat: coords.lat,
      lng: coords.lng,
      want: wantInput.checked,
      createdAt: Date.now()
    });
    localStorage.setItem('my-place-map-places-v2', JSON.stringify(places));

    // Make the newly saved place visible even if it is outside the current 3 km filter.
    radiusSelect.value = '999';
    dialog.close();
    window.__myPlaceMapMain?.setView([coords.lat, coords.lng], 17, { animate: true });
    location.reload();
  }, true);

  // Clicking the body of a saved card (not its buttons) centers the map on that place.
  document.addEventListener('click', e => {
    const card = e.target.closest('.place-card');
    if (!card || e.target.closest('button, a, input, select, textarea')) return;
    const id = card.id?.replace(/^place-/, '');
    let places = [];
    try { places = JSON.parse(localStorage.getItem('my-place-map-places-v2') || '[]'); } catch (_) {}
    const place = places.find(p => p.id === id);
    if (place && window.__myPlaceMapMain) {
      window.__myPlaceMapMain.setView([place.lat, place.lng], Math.max(window.__myPlaceMapMain.getZoom(), 16), { animate: true });
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target === addressInput) { e.preventDefault(); e.stopImmediatePropagation(); searchAddressNew(); }
  }, true);
})();
