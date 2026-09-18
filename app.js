const STORAGE_KEY='my-place-map-places-v2';
const GEOCODER='https://nominatim.openstreetmap.org';
const ARCGIS='https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates';
let places=loadPlaces(),currentLocation=null,activeFilter='all',map,userMarker,userAccuracy,placeMarkers=new Map();
let pickerMap=null,pickerMarker=null,pickerPosition=null;
const els={placeList:document.getElementById('placeList'),countText:document.getElementById('countText'),radius:document.getElementById('radiusSelect'),locate:document.getElementById('locateBtn'),add:document.getElementById('addBtn'),dialog:document.getElementById('placeDialog'),form:document.getElementById('placeForm'),closePlace:document.getElementById('closePlaceBtn'),cancelPlace:document.getElementById('cancelPlaceBtn'),name:document.getElementById('nameInput'),address:document.getElementById('addressInput'),searchAddress:document.getElementById('searchAddressBtn'),addressResults:document.getElementById('addressResults'),pickLocation:document.getElementById('pickLocationBtn'),selectedLocation:document.getElementById('selectedLocation'),category:document.getElementById('categoryInput'),note:document.getElementById('noteInput'),coord:document.getElementById('coordInput'),lat:document.getElementById('latInput'),lng:document.getElementById('lngInput'),want:document.getElementById('wantInput'),error:document.getElementById('formError'),mapHint:document.getElementById('mapHint'),pickerOverlay:document.getElementById('pickerOverlay'),pickerCoords:document.getElementById('pickerCoords'),confirmPicker:document.getElementById('confirmPickerBtn'),closePicker:document.getElementById('closePickerBtn'),ratingDialog:document.getElementById('ratingDialog'),ratingName:document.getElementById('ratingName'),ratingAddress:document.getElementById('ratingAddress'),ratingOptions:document.getElementById('ratingOptions'),saveBtn:document.getElementById('saveBtn'),ratingError:document.getElementById('ratingError'),closeRating:document.getElementById('closeRatingBtn')};
const categoryInfo={food:{icon:'🍜',label:'Ăn uống'},fun:{icon:'🎮',label:'Vui chơi'},cafe:{icon:'☕',label:'Cafe'},other:{icon:'📌',label:'Khác'}};
const ratingInfo={like:{icon:'❤️',label:'Thích'},neutral:{icon:'😶',label:'Bình thường'},dislike:{icon:'💔',label:'Không thích'}};
let ratingPlaceId=null,editingPlaceId=null;
function validCoord(lat,lng){return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180}
function parseCoords(text){const m=String(text||'').trim().replace(/\s+/g,' ').match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))$/);if(!m)return null;const lat=Number(m[1]),lng=Number(m[2]);return validCoord(lat,lng)?{lat,lng}:null}
function syncCoords(lat,lng){if(!validCoord(lat,lng))return false;els.coord.value=`${lat}, ${lng}`;els.lat.value=String(lat);els.lng.value=String(lng);els.selectedLocation.textContent=`📍 Đã chọn: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;return true}
function readCoords(){const c=parseCoords(els.coord.value);if(c){syncCoords(c.lat,c.lng);return c}const lat=Number(els.lat.value),lng=Number(els.lng.value);return validCoord(lat,lng)?{lat,lng}:null}
function normalizePlace(p){return{id:String(p.id),name:String(p.name||''),address:String(p.address||''),category:String(p.category||'food'),note:String(p.note||''),lat:Number(p.lat),lng:Number(p.lng),want:Boolean(p.want),rating:['like','neutral','dislike'].includes(p.rating)?p.rating:null,createdAt:Number(p.createdAt??p.created_at??Date.now())}}
function loadPlaces(){try{const arr=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');const seen=new Set();const out=arr.map(normalizePlace).filter(p=>{const key=`${p.name}|${p.lat}|${p.lng}|${p.address}`;if(seen.has(key))return false;seen.add(key);return true});if(out.length!==arr.length)localStorage.setItem(STORAGE_KEY,JSON.stringify(out));return out}catch(_){return[]}}
function savePlaces(){localStorage.setItem(STORAGE_KEY,JSON.stringify(places))}
const SUPABASE_URL='https://ieywxjnybpfchocvgvqt.supabase.co';
const SUPABASE_KEY='sb_publishable_TKSDmnJWKpM14A0H8pDxug_Ny2SGHYD';
async function api(path,options={}){
  const method=(options.method||'GET').toUpperCase();
  let url=path;
  if(path==='/api/places') url=`${SUPABASE_URL}/rest/v1/places?select=*&order=created_at.asc`;
  else {
    const m=path.match(/^\/api\/places\/([^/]+)$/);
    if(m) url=`${SUPABASE_URL}/rest/v1/places?id=eq.${encodeURIComponent(m[1])}`;
  }
  const headers={Accept:'application/json','Content-Type':'application/json','apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,...(options.headers||{})};
  const body=options.body;
  let payload=body;
  if(body && method==='POST'){
    const p=JSON.parse(body);
    payload=JSON.stringify({id:p.id,name:p.name,address:p.address,category:p.category,note:p.note,lat:p.lat,lng:p.lng,want:p.want,rating:p.rating,created_at:p.createdAt});
    headers.Prefer='return=representation';
  }
  const res=await fetch(url,{...options,method,headers,body:payload});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(data.message||data.error||'API error'),{status:res.status,code:data.error});
  if(method==='GET') return {places:Array.isArray(data)?data:[]};
  if(method==='POST') return {place:Array.isArray(data)?data[0]:data};
  if(method==='PATCH') return {place:Array.isArray(data)?data[0]:data};
  return data;
}
async function syncRemote(){try{const data=await api('/api/places');const remote=Array.isArray(data.places)?data.places.map(normalizePlace):[];places=remote;savePlaces();render()}catch(_){}
}
function distanceKm(aLat,aLng,bLat,bLng){const R=6371,p1=aLat*Math.PI/180,p2=bLat*Math.PI/180,dp=(bLat-aLat)*Math.PI/180,dl=(bLng-aLng)*Math.PI/180,x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
function filteredPlaces(){const radius=Number(els.radius.value);return places.map(p=>({...p,distance:currentLocation?distanceKm(currentLocation.lat,currentLocation.lng,p.lat,p.lng):null})).filter(p=>{if(activeFilter==='want'&&!p.want)return false;if(['food','fun','cafe'].includes(activeFilter)&&p.category!==activeFilter)return false;if(currentLocation&&radius<999&&p.distance>radius)return false;return true}).sort((a,b)=>a.distance!=null&&b.distance!=null?a.distance-b.distance:b.createdAt-a.createdAt)}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
function openDirections(lat,lng){window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`,'_blank','noopener')}
function markerIcon(p){const r=ratingInfo[p.rating];const text=r?r.icon:(categoryInfo[p.category]?.icon||'📌');return L.divIcon({className:'place-marker-wrap',html:`<div class="place-marker ${r?'rated-marker':''}" title="${escapeHtml(r?.label||'Đánh giá địa điểm')}">${text}</div>`,iconSize:[38,38],iconAnchor:[19,19],popupAnchor:[0,-18]})}
function renderMarkers(data){placeMarkers.forEach(m=>m.remove());placeMarkers.clear();data.forEach(p=>{if(!validCoord(Number(p.lat),Number(p.lng)))return;const marker=L.marker([p.lat,p.lng],{icon:markerIcon(p)}).addTo(map);marker.bindPopup(`<div class="popup"><strong>${categoryInfo[p.category]?.icon||'📌'} ${escapeHtml(p.name)}</strong><div>${escapeHtml(categoryInfo[p.category]?.label||'Khác')}</div>${p.rating?`<div class="popup-rating">${ratingInfo[p.rating].icon} ${ratingInfo[p.rating].label}</div>`:''}${p.address?`<div>📍 ${escapeHtml(p.address)}</div>`:''}${p.note?`<p>${escapeHtml(p.note)}</p>`:''}${p.want?'<span>❤️ Muốn đi</span>':''}<br><button class="popup-rate" data-id="${escapeHtml(p.id)}">⭐ Đánh giá</button> <button class="popup-direction" data-lat="${p.lat}" data-lng="${p.lng}">🧭 Chỉ đường</button></div>`);marker.on('popupopen',e=>{const el=e.popup.getElement();el?.querySelector('.popup-rate')?.addEventListener('click',()=>openRating(p.id));el?.querySelector('.popup-direction')?.addEventListener('click',()=>openDirections(Number(p.lat),Number(p.lng)))});placeMarkers.set(p.id,marker)})}
function ratingBadge(p){return p.rating?`<button type="button" class="rating-badge" data-rating-id="${p.id}">${ratingInfo[p.rating].icon} ${ratingInfo[p.rating].label}</button>`:`<button type="button" class="rating-badge unrated" data-rating-id="${p.id}">⭐ Chưa đánh giá</button>`}
function render(){const data=filteredPlaces();els.countText.textContent=`${data.length} địa điểm`;els.placeList.innerHTML='';renderMarkers(data);if(!data.length){els.placeList.innerHTML='<div class="empty">Chưa có địa điểm phù hợp. Bấm <b>＋ Thêm địa điểm</b> hoặc nhấp đúp trên bản đồ để lưu.</div>';return}data.forEach(p=>{const icon=categoryInfo[p.category]?.icon||'📌',dist=p.distance==null?'Chưa xác định khoảng cách':`${p.distance.toFixed(1)} km từ bạn`,card=document.createElement('article');card.className='place-card';card.id=`place-${p.id}`;card.innerHTML=`<div class="place-title">${icon} ${escapeHtml(p.name)}</div><div class="place-meta">${escapeHtml(categoryInfo[p.category]?.label||'Khác')} · ${dist}</div>${p.address?`<button type="button" class="place-address place-address-button" data-rating-id="${p.id}">📍 ${escapeHtml(p.address)}</button>`:''}${p.note?`<div class="place-note">${escapeHtml(p.note)}</div>`:''}${p.want?'<span class="badge">❤️ Muốn đi</span>':''}<div class="place-rating-row">${ratingBadge(p)}</div><div class="card-actions"><button type="button" class="secondary show-place" data-id="${p.id}">📍 Xem trên bản đồ</button><button type="button" class="secondary open-map" data-lat="${p.lat}" data-lng="${p.lng}">🧭 Chỉ đường</button><button type="button" class="secondary delete-place" data-id="${p.id}">Xóa</button></div>`;els.placeList.appendChild(card)});els.placeList.querySelectorAll('.place-card').forEach(card=>card.onclick=e=>{if(e.target.closest('button,a,input,select,textarea'))return;const id=card.id.replace(/^place-/,'');openEditDialog(id)});els.placeList.querySelectorAll('.place-address-button,.rating-badge').forEach(b=>b.onclick=()=>openRating(b.dataset.ratingId));els.placeList.querySelectorAll('.show-place').forEach(b=>b.onclick=()=>{const p=places.find(x=>x.id===b.dataset.id);if(p){map.setView([p.lat,p.lng],18,{animate:true});placeMarkers.get(p.id)?.openPopup()}});els.placeList.querySelectorAll('.open-map').forEach(b=>b.onclick=()=>openDirections(Number(b.dataset.lat),Number(b.dataset.lng)));els.placeList.querySelectorAll('.delete-place').forEach(b=>b.onclick=async()=>{const id=b.dataset.id;try{await api(`/api/places/${encodeURIComponent(id)}`,{method:'DELETE'})}catch(_){}places=places.filter(p=>p.id!==id);savePlaces();render()})}
function initMap(){map=L.map('map',{zoomControl:true}).setView([10.7769,106.7009],13);window.__myPlaceMapMain=map;L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);map.doubleClickZoom.disable();map.on('dblclick',e=>{L.DomEvent.stop(e);openAddDialog(e.latlng.lat,e.latlng.lng);reverseGeocode(e.latlng.lat,e.latlng.lng,true)})}
async function nominatimSearch(q){const u=new URL(`${GEOCODER}/search`);u.searchParams.set('format','jsonv2');u.searchParams.set('limit','8');u.searchParams.set('countrycodes','vn');u.searchParams.set('addressdetails','1');u.searchParams.set('q',q);const r=await fetch(u,{headers:{Accept:'application/json'}});if(!r.ok)throw Error();return r.json()}
async function arcgisSearch(q){const u=new URL(ARCGIS);u.searchParams.set('SingleLine',q);u.searchParams.set('f','json');u.searchParams.set('maxLocations','8');u.searchParams.set('outFields','*');const r=await fetch(u);if(!r.ok)throw Error();const d=await r.json();return(d.candidates||[]).map(x=>({display_name:x.address,lat:Number(x.location?.y),lon:Number(x.location?.x)})).filter(x=>validCoord(x.lat,x.lon))}
function renderSearchResult(title,onClick){const b=document.createElement('button');b.type='button';b.className='address-result';b.textContent=title;b.onclick=onClick;els.addressResults.appendChild(b)}
async function searchAddress(){const q=els.address.value.trim();els.error.textContent='';els.addressResults.innerHTML='';if(!q){els.error.textContent='Hãy nhập địa chỉ cần tìm.';return}els.searchAddress.disabled=true;els.searchAddress.textContent='⌛ Đang tìm...';try{let results=[];try{results=await nominatimSearch(q)}catch(_){}if(!results.length){try{results=await arcgisSearch(q)}catch(_){}}if(!results.length){els.addressResults.innerHTML='<div class="address-no-result">Không tìm thấy địa chỉ. Hãy thử viết ngắn hơn hoặc dán tọa độ Google Maps.</div>';return}results.forEach(r=>{const lat=Number(r.lat),lng=Number(r.lon);renderSearchResult(r.display_name,()=>{els.address.value=r.display_name;syncCoords(lat,lng);els.addressResults.innerHTML='';map.setView([lat,lng],18,{animate:true});els.mapHint.textContent='📍 Đã chọn kết quả tìm kiếm. Nếu cần đúng vị trí số nhà, dán tọa độ Google Maps.'})})}catch(_){els.error.textContent='Không thể tìm địa chỉ lúc này. M vẫn có thể dán tọa độ Google Maps.'}finally{els.searchAddress.disabled=false;els.searchAddress.textContent='🔎 Tìm địa chỉ'}}
async function reverseGeocode(lat,lng,fill=false){try{const u=new URL(`${GEOCODER}/reverse`);u.searchParams.set('format','jsonv2');u.searchParams.set('lat',lat);u.searchParams.set('lon',lng);u.searchParams.set('zoom','18');u.searchParams.set('addressdetails','1');const r=await fetch(u,{headers:{Accept:'application/json'}});const d=await r.json();if(fill&&d.display_name)els.address.value=d.display_name;return d.display_name||''}catch(_){return''}}
function openEditDialog(id){
  const p=places.find(x=>x.id===id);
  if(!p)return;
  editingPlaceId=id;
  els.error.textContent='';
  els.addressResults.innerHTML='';
  els.name.value=p.name;
  els.address.value=p.address;
  els.note.value=p.note;
  els.coord.value='';
  els.lat.value='';
  els.lng.value='';
  els.selectedLocation.textContent='Chưa chọn vị trí chính xác';
  els.want.checked=!!p.want;
  els.category.value=p.category||'food';
  syncCoords(p.lat,p.lng);
  els.dialog.querySelector('h3').textContent='✏️ Chỉnh sửa địa điểm';
  els.saveBtn?.remove?.();
  if(els.saveBtn) els.saveBtn.textContent='Lưu thay đổi';
  els.dialog.showModal();
  setTimeout(()=>els.name.focus(),50);
}
function openAddDialog(lat=null,lng=null){
  editingPlaceId=null;
  els.dialog.querySelector('h3').textContent='Thêm địa điểm';
  if(els.saveBtn) els.saveBtn.textContent='Lưu địa điểm';els.error.textContent='';els.addressResults.innerHTML='';els.name.value='';els.address.value='';els.note.value='';els.coord.value='';els.lat.value='';els.lng.value='';els.selectedLocation.textContent='Chưa chọn vị trí chính xác';els.want.checked=false;els.category.value='food';if(validCoord(lat,lng))syncCoords(lat,lng);els.dialog.showModal();setTimeout(()=>els.name.focus(),50)}
function closePlaceDialog(){if(els.dialog.open)els.dialog.close();els.error.textContent='';els.addressResults.innerHTML=''}
function setPickerPosition(lat,lng){if(!validCoord(lat,lng))return;pickerPosition={lat,lng};if(pickerMarker)pickerMarker.setLatLng([lat,lng]);else{pickerMarker=L.marker([lat,lng],{draggable:true}).addTo(pickerMap);pickerMarker.on('dragend',()=>{const p=pickerMarker.getLatLng();setPickerPosition(p.lat,p.lng)})}els.pickerCoords.textContent=`📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`}
function openPicker(){const c=readCoords(),center=c||(map?map.getCenter():{lat:10.7769,lng:106.7009});els.dialog.close();els.pickerOverlay.hidden=false;if(!pickerMap){pickerMap=L.map('pickerMap',{zoomControl:true,doubleClickZoom:false}).setView([center.lat,center.lng],18);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'&copy; OpenStreetMap contributors'}).addTo(pickerMap);pickerMap.on('click',e=>setPickerPosition(e.latlng.lat,e.latlng.lng))}setTimeout(()=>{pickerMap.invalidateSize();pickerMap.setView([center.lat,center.lng],18);setPickerPosition(center.lat,center.lng)},100)}
function closePicker(){els.pickerOverlay.hidden=true;if(!els.dialog.open)els.dialog.showModal()}
async function confirmPicker(){if(!pickerPosition){els.pickerCoords.textContent='⚠️ Hãy chọn vị trí trên bản đồ.';return}const{lat,lng}=pickerPosition;syncCoords(lat,lng);const a=await reverseGeocode(lat,lng);if(a)els.address.value=a;closePicker();els.mapHint.textContent='🎯 Đã chọn vị trí chính xác. Bấm Lưu địa điểm.'}
async function savePlace(e){
  e.preventDefault();
  els.error.textContent='';
  const name=els.name.value.trim(),c=readCoords();
  if(!name){els.error.textContent='Hãy nhập tên địa điểm.';return}
  if(!c){els.error.textContent='Hãy dán tọa độ theo dạng: Vĩ độ, Kinh độ (ví dụ 10.800829838769747, 106.68482208597538).';return}
  const address=els.address.value.trim();
  const duplicate=places.some(p=>p.id!==editingPlaceId&&p.name.trim().toLowerCase()===name.toLowerCase()&&Math.abs(Number(p.lat)-c.lat)<1e-12&&Math.abs(Number(p.lng)-c.lng)<1e-12);
  if(duplicate){els.error.textContent='Địa điểm này đã tồn tại.';return}
  els.saveBtn.disabled=true;
  els.saveBtn.textContent='⌛ Đang lưu...';
  try{
    if(editingPlaceId){
      const existing=places.find(p=>p.id===editingPlaceId);
      const updated=normalizePlace({
        ...existing,
        name,
        address,
        category:els.category.value,
        note:els.note.value.trim(),
        lat:c.lat,
        lng:c.lng,
        want:els.want.checked
      });
      await api(`/api/places/${encodeURIComponent(editingPlaceId)}`,{
        method:'PATCH',
        body:JSON.stringify({
          name:updated.name,
          address:updated.address,
          category:updated.category,
          note:updated.note,
          lat:updated.lat,
          lng:updated.lng,
          want:updated.want
        })
      });
      const pos=places.findIndex(p=>p.id===editingPlaceId);
      if(pos>=0)places[pos]=updated;
      els.error.textContent='';
      editingPlaceId=null;
      closePlaceDialog();
      render();
      map.setView([c.lat,c.lng],18,{animate:true});
      els.mapHint.textContent='✏️ Đã cập nhật toàn bộ thông tin địa điểm.';
    }else{
      const place=normalizePlace({id:window.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`,name,address,category:els.category.value,note:els.note.value.trim(),lat:c.lat,lng:c.lng,want:els.want.checked,rating:null,createdAt:Date.now()});
      await api('/api/places',{method:'POST',body:JSON.stringify(place)});
      places.push(place);
      els.radius.value='999';
      closePlaceDialog();
      render();
      map.setView([c.lat,c.lng],18,{animate:true});
      els.mapHint.textContent='📍 Đã lưu địa điểm tại đúng tọa độ Google Maps.';
    }
    savePlaces();
  }catch(err){
    els.error.textContent=editingPlaceId?'Không cập nhật được địa điểm. Thử lại sau.':'Không lưu được địa điểm vào dữ liệu chung. Thử lại sau.';
  }finally{
    els.saveBtn.disabled=false;
    els.saveBtn.textContent=editingPlaceId?'Lưu thay đổi':'Lưu địa điểm';
  }
}
function openRating(id){const p=places.find(x=>x.id===id);if(!p||!els.ratingDialog)return;ratingPlaceId=id;els.ratingName.textContent=p.name;els.ratingAddress.textContent=p.address||`${p.lat}, ${p.lng}`;els.ratingError.textContent='';els.ratingOptions.querySelectorAll('[data-rating]').forEach(b=>b.classList.toggle('selected',b.dataset.rating===p.rating));els.ratingDialog.showModal()}
async function setRating(rating){const p=places.find(x=>x.id===ratingPlaceId);if(!p)return;els.ratingError.textContent='⏳ Đang lưu...';try{await api(`/api/places/${encodeURIComponent(p.id)}`,{method:'PATCH',body:JSON.stringify({rating})});p.rating=rating;savePlaces();els.ratingDialog.close();render();map.setView([p.lat,p.lng],18,{animate:true});placeMarkers.get(p.id)?.openPopup()}catch(_){els.ratingError.textContent='Không lưu được đánh giá. Kiểm tra lại kết nối.'}}
function setCurrentLocation(lat,lng,accuracy){currentLocation={lat,lng};if(userMarker)userMarker.setLatLng([lat,lng]);else userMarker=L.circleMarker([lat,lng],{radius:8,color:'#fff',weight:3,fillColor:'#1976d2',fillOpacity:1}).addTo(map).bindTooltip('Vị trí của bạn');if(userAccuracy)userAccuracy.remove();if(accuracy>0)userAccuracy=L.circle([lat,lng],{radius:accuracy,color:'#1976d2',weight:1,fillOpacity:.08}).addTo(map);map.setView([lat,lng],15);els.mapHint.textContent='📍 Đã xác định vị trí của bạn. Nhấp đúp trên bản đồ để thêm địa điểm.';render()}
function useLocation(){
  if(!navigator.geolocation){
    els.mapHint.textContent='⚠️ Trình duyệt không hỗ trợ định vị.';
    return;
  }
  if(!window.isSecureContext){
    els.mapHint.textContent='⚠️ Trang chưa chạy HTTPS nên không thể lấy vị trí.';
    return;
  }
  els.locate.disabled=true;
  els.locate.textContent='⌛ Đang định vị...';
  navigator.geolocation.getCurrentPosition(
    p=>{
      setCurrentLocation(p.coords.latitude,p.coords.longitude,p.coords.accuracy);
      els.locate.disabled=false;
      els.locate.textContent='📍 Vị trí của tôi';
    },
    err=>{
      let msg='⚠️ Không lấy được vị trí.';
      if(err.code===1){
        msg='⚠️ Safari đang chặn quyền vị trí cho trang này. Vào Safari → Cài đặt cho trang web → Vị trí → Cho phép, rồi bấm “📍 Vị trí của tôi” lại.';
      }else if(err.code===2){
        msg='⚠️ Safari chưa xác định được vị trí thiết bị. Kiểm tra Dịch vụ định vị của máy rồi thử lại.';
      }else if(err.code===3){
        msg='⚠️ Lấy vị trí quá lâu. Kiểm tra Wi‑Fi/Internet rồi thử lại.';
      }
      els.mapHint.textContent=msg;
      els.locate.disabled=false;
      els.locate.textContent='📍 Vị trí của tôi';
      render();
    },
    {enableHighAccuracy:true,timeout:15000,maximumAge:30000}
  );
}

els.add.onclick=()=>openAddDialog();els.closePlace.onclick=closePlaceDialog;els.cancelPlace.onclick=closePlaceDialog;els.form.addEventListener('submit',savePlace);els.searchAddress.onclick=searchAddress;els.pickLocation.onclick=openPicker;els.closePicker.onclick=closePicker;els.confirmPicker.onclick=confirmPicker;els.locate.onclick=useLocation;els.radius.onchange=render;
document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeFilter=b.dataset.filter;render()});
els.ratingOptions?.querySelectorAll('[data-rating]').forEach(b=>b.onclick=()=>setRating(b.dataset.rating));els.closeRating?.addEventListener('click',()=>els.ratingDialog.close());
initMap();render();syncRemote();setTimeout(useLocation,250);
