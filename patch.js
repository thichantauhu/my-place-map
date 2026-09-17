(() => {
  const addressInput = document.getElementById('addressInput');
  const searchBtn = document.getElementById('searchAddressBtn');
  const resultsBox = document.getElementById('addressResults');
  const dialog = document.getElementById('placeDialog');
  const pickBtn = document.getElementById('pickLocationBtn');
  const pickerOverlay = document.getElementById('pickerOverlay');
  const pickerMapEl = document.getElementById('pickerMap');
  const pickerCoords = document.getElementById('pickerCoords');
  const confirmBtn = document.getElementById('confirmPickerBtn');
  const closePickerBtn = document.getElementById('closePickerBtn');
  const latInput = document.getElementById('latInput');
  const lngInput = document.getElementById('lngInput');
  const selectedLocation = document.getElementById('selectedLocation');
  const error = document.getElementById('formError');
  const mapHint = document.getElementById('mapHint');

  let sessionToken = null;
  let pickerMap = null;
  let pickerMarker = null;
  let pickerPosition = null;

  const validCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
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
      } catch (e) {
        if (e.code === 'GOGODUK_API_KEY_NOT_CONFIGURED') {
          resultsBox.innerHTML = '<div class="address-no-result">⚠️ Chưa cấu hình GoGoDuk. M thêm API key miễn phí vào Render để dùng tìm địa chỉ Việt Nam chính xác hơn.</div>';
          return;
        }
        const results = await nominatimSearch(q);
        data = { source: 'nominatim', predictions: results.map(r => ({ text: r.display_name, mainText: r.display_name, secondaryText: '', lat: Number(r.lat), lng: Number(r.lon) })) };
      }

      if (!data.predictions?.length) {
        resultsBox.innerHTML = '<div class="address-no-result">Không tìm thấy địa chỉ. Thử nhập thêm tên đường, phường hoặc thành phố.</div>';
        return;
      }

      data.predictions.forEach(p => {
        renderResult(p.mainText || p.text, p.secondaryText || (p.mainText !== p.text ? p.text : ''), async () => {
          if (data.source === 'gogoduk') {
            addressInput.value = p.text || p.mainText || '';
            selectedLocation.textContent = '⌛ Đang lấy tọa độ chính xác...';
            try {
              const resolved = await api('/api/address-resolve', { id: p.placeId, sessionToken });
              const place = resolved.place;
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
              error.textContent = 'Không lấy được tọa độ địa chỉ này. Thử lại hoặc chọn chính xác trên bản đồ.';
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
      error.textContent = 'Không thể tìm địa chỉ lúc này. Thử lại sau.';
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
    pickerOverlay.hidden = false;
    const lat = Number(latInput.value), lng = Number(lngInput.value);
    pickerPosition = validCoord(lat, lng) ? { lat, lng } : null;

    if (!pickerMap) {
      pickerMap = L.map('pickerMap', { zoomControl: true }).setView(pickerPosition ? [pickerPosition.lat, pickerPosition.lng] : [10.7769, 106.7009], pickerPosition ? 18 : 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap contributors' }).addTo(pickerMap);
      pickerMap.on('click', e => setPickerPosition(e.latlng.lat, e.latlng.lng));
    }
    setTimeout(() => {
      pickerMap.invalidateSize();
      if (pickerPosition) { pickerMap.setView([pickerPosition.lat, pickerPosition.lng], 18); setPickerPosition(pickerPosition.lat, pickerPosition.lng); }
    }, 80);
    pickerCoords.textContent = pickerPosition ? `📍 ${pickerPosition.lat.toFixed(6)}, ${pickerPosition.lng.toFixed(6)}` : 'Bấm vào bản đồ để chọn vị trí';
  }

  function reopenDialog() {
    pickerOverlay.hidden = true;
    if (!dialog.open) dialog.showModal();
  }

  async function confirmPickerNew() {
    if (!pickerPosition) { pickerCoords.textContent = '⚠️ Hãy bấm lên bản đồ để chọn vị trí.'; return; }
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

  // Capture phase runs before the old handlers in app.js, so these handlers replace them cleanly.
  document.addEventListener('click', e => {
    if (e.target.closest('#searchAddressBtn')) { e.preventDefault(); e.stopImmediatePropagation(); searchAddressNew(); }
    else if (e.target.closest('#pickLocationBtn')) { e.preventDefault(); e.stopImmediatePropagation(); openPickerNew(); }
    else if (e.target.closest('#closePickerBtn')) { e.preventDefault(); e.stopImmediatePropagation(); reopenDialog(); }
    else if (e.target.closest('#confirmPickerBtn')) { e.preventDefault(); e.stopImmediatePropagation(); confirmPickerNew(); }
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target === addressInput) { e.preventDefault(); e.stopImmediatePropagation(); searchAddressNew(); }
  }, true);
})();
