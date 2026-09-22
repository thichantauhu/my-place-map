const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const GOGODUK_API_KEY = process.env.GOGODUK_API_KEY || '';
const GOGODUK_API = 'https://api.gogoduk.com';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function send(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store'});
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function gogodukRequest(pathname, params) {
  if (!GOGODUK_API_KEY) throw Object.assign(new Error('GOGODUK_API_KEY_NOT_CONFIGURED'), { code: 'GOGODUK_API_KEY_NOT_CONFIGURED' });
  const url = new URL(`${GOGODUK_API}${pathname}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  const response = await fetch(url, {headers: {'X-API-Key': GOGODUK_API_KEY, Accept: 'application/json'}});
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data?.message || data?.error || `GoGoDuk HTTP ${response.status}`), {code: data?.code || `HTTP_${response.status}`, status: response.status, data});
  return data;
}

async function addressSuggest(res, query, sessionToken) {
  try {
    const data = await gogodukRequest('/v1/suggest', {input: query, lang: 'vi', country: 'VN', sessionToken});
    return send(res, 200, {source: 'gogoduk', predictions: (data.predictions || []).map(p => ({placeId: p.placeId || '', text: p.text || '', mainText: p.mainText || '', secondaryText: p.secondaryText || '', types: p.types || []}))});
  } catch (error) {
    return send(res, error.status || 503, {error: error.code || 'GOGODUK_ERROR', message: error.message || 'Không thể tìm địa chỉ bằng GoGoDuk.'});
  }
}

async function placeResolve(res, id, sessionToken) {
  try {
    const data = await gogodukRequest('/v1/place/resolve', {id, lang: 'vi', sessionToken});
    const p = data.result || {};
    return send(res, 200, {source: 'gogoduk', place: {placeId: p.placeId || id, name: p.name || '', address: p.address || '', lat: p.lat, lng: p.lon, district: p.district || '', city: p.city || '', country: p.country || 'VN'}});
  } catch (error) {
    return send(res, error.status || 503, {error: error.code || 'GOGODUK_ERROR', message: error.message || 'Không thể lấy tọa độ địa chỉ.'});
  }
}

async function addressReverse(res, lat, lng) {
  try {
    const data = await gogodukRequest('/v1/reverse', {'point.lat': lat, 'point.lon': lng, size: 1, lang: 'vi', 'boundary.country': 'VN'});
    const p = data.results?.[0];
    return send(res, 200, {source: 'gogoduk', address: p?.address || '', lat: p?.lat ?? Number(lat), lng: p?.lon ?? Number(lng), confidence: p?.confidence ?? null});
  } catch (error) {
    return send(res, error.status || 503, {error: error.code || 'GOGODUK_ERROR', message: error.message || 'Không thể lấy địa chỉ từ tọa độ.'});
  }
}

function supabaseConfigured() { return Boolean(SUPABASE_URL && SUPABASE_KEY); }

async function supabaseRequest(method, pathname, body) {
  if (!supabaseConfigured()) throw Object.assign(new Error('SUPABASE_NOT_CONFIGURED'), {code: 'SUPABASE_NOT_CONFIGURED'});
  const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Prefer'] = 'return=representation';
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body)});
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = {raw: text}; }
  if (!response.ok) throw Object.assign(new Error(data?.message || data?.hint || data?.details || `Supabase HTTP ${response.status}`), {code: data?.code || `HTTP_${response.status}`, status: response.status, data});
  return data;
}

function normalizeRating(value) {
  return ['like', 'neutral', 'dislike'].includes(value) ? value : null;
}

function normalizePlace(p) {
  return {
    id: String(p.id), name: String(p.name || ''), address: String(p.address || ''),
    category: String(p.category || 'food'), note: String(p.note || ''), link: String(p.link || ''), lat: Number(p.lat), lng: Number(p.lng),
    want: Boolean(p.want), rating: normalizeRating(p.rating), createdAt: Number(p.createdAt ?? p.created_at ?? Date.now())
  };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) reject(new Error('BODY_TOO_LARGE'));
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (_) { reject(new Error('INVALID_JSON')); } });
    req.on('error', reject);
  });
}

async function handlePlaces(req, res, url) {
  if (!url.pathname.startsWith('/api/places')) return false;
  if (!supabaseConfigured()) return send(res, 503, {error: 'SUPABASE_NOT_CONFIGURED', message: 'Chưa cấu hình Supabase.'});
  try {
    if (req.method === 'GET' && url.pathname === '/api/places') {
      const rows = await supabaseRequest('GET', 'places?select=*&order=created_at.asc');
      return send(res, 200, {places: Array.isArray(rows) ? rows.map(normalizePlace) : []});
    }
    if (req.method === 'POST' && url.pathname === '/api/places') {
      const p = normalizePlace(await readBody(req));
      if (!p.id || !p.name || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return send(res, 400, {error: 'INVALID_PLACE', message: 'Dữ liệu địa điểm không hợp lệ.'});
      const row = {id:p.id,name:p.name,address:p.address,category:p.category,note:p.note,link:p.link,lat:p.lat,lng:p.lng,want:p.want,rating:p.rating,created_at:p.createdAt};
      const rows = await supabaseRequest('POST', 'places', [row]);
      return send(res, 201, {place: normalizePlace(Array.isArray(rows) ? rows[0] : row)});
    }
    const match = url.pathname.match(/^\/api\/places\/([^/]+)$/);
    if (req.method === 'PATCH' && match) {
      const body = await readBody(req);
      const update = {};
      if (Object.prototype.hasOwnProperty.call(body, 'rating')) {
        const wantsClear = body.rating === null || body.rating === '' || body.rating === undefined;
        const rating = normalizeRating(body.rating);
        if (!wantsClear && !rating) return send(res, 400, {error:'INVALID_RATING', message:'Đánh giá không hợp lệ.'});
        update.rating = rating;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'address')) {
        update.address = String(body.address || '').trim();
      }
      if (Object.prototype.hasOwnProperty.call(body, 'name')) update.name = String(body.name || '').trim();
      if (Object.prototype.hasOwnProperty.call(body, 'category')) update.category = String(body.category || 'food');
      if (Object.prototype.hasOwnProperty.call(body, 'note')) update.note = String(body.note || '').trim();
      if (Object.prototype.hasOwnProperty.call(body, 'link')) update.link = String(body.link || '').trim();
      if (Object.prototype.hasOwnProperty.call(body, 'lat')) update.lat = Number(body.lat);
      if (Object.prototype.hasOwnProperty.call(body, 'lng')) update.lng = Number(body.lng);
      if (Object.prototype.hasOwnProperty.call(body, 'want')) update.want = Boolean(body.want);
      if (Object.prototype.hasOwnProperty.call(body, 'lat') && !Number.isFinite(update.lat)) return send(res,400,{error:'INVALID_LAT',message:'Vĩ độ không hợp lệ.'});
      if (Object.prototype.hasOwnProperty.call(body, 'lng') && !Number.isFinite(update.lng)) return send(res,400,{error:'INVALID_LNG',message:'Kinh độ không hợp lệ.'});
      if (!Object.keys(update).length) return send(res, 400, {error:'EMPTY_UPDATE', message:'Không có nội dung cần cập nhật.'});
      const rows = await supabaseRequest('PATCH', `places?id=eq.${encodeURIComponent(match[1])}`, update);
      const row = Array.isArray(rows) ? rows[0] : null;
      return send(res, 200, {place: row ? normalizePlace(row) : {id:match[1], ...update}});
    }
    if (req.method === 'DELETE' && match) {
      await supabaseRequest('DELETE', `places?id=eq.${encodeURIComponent(match[1])}`);
      return send(res, 200, {ok: true});
    }
    return send(res, 404, {error:'NOT_FOUND'});
  } catch (error) {
    console.error('Places API error:', error);
    return send(res, error.status || 502, {error:error.code || 'SUPABASE_ERROR', message:error.message || 'Không thể truy cập dữ liệu địa điểm.'});
  }
}

async function valhallaMatrix(payload) {
  const requestPayload = {
    ...payload,
    costing: 'motor_scooter',
    units: 'kilometers',
    verbose: true
  };
  const response = await fetch('https://valhalla1.openstreetmap.de/sources_to_targets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'my-place-map/1.0',
      'X-Client-Id': 'my-place-map.onrender.com'
    },
    body: JSON.stringify(requestPayload)
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;

  // Valhalla rejects a matrix when any route exceeds its 100 km path limit.
  // Split targets recursively so one far-away place cannot invalidate
  // all nearby distances.
  if (data?.error_code === 154 && requestPayload.targets.length > 1) {
    const mid = Math.ceil(requestPayload.targets.length / 2);
    const left = await valhallaMatrix({...requestPayload, targets: requestPayload.targets.slice(0, mid)});
    const right = await valhallaMatrix({...requestPayload, targets: requestPayload.targets.slice(mid)});
    const leftRows = left?.sources_to_targets?.[0] || [];
    const rightRows = right?.sources_to_targets?.[0] || [];
    return {sources_to_targets: [[...leftRows, ...rightRows]]};
  }

  console.error('Valhalla routing error:', response.status, data);
  return {sources_to_targets: [[]], routing_errors: [data]};
}

async function roadDistance(req, res, url) {
  try {
    let payload;
    if (req.method === 'POST') {
      payload = await readBody(req);
    } else {
      const raw = url.searchParams.get('payload');
      if (!raw) return send(res,400,{error:'MISSING_PAYLOAD'});
      payload = JSON.parse(raw);
    }
    if (!payload?.sources?.length || !payload?.targets?.length) {
      return send(res,400,{error:'INVALID_PAYLOAD'});
    }
    if (!payload.sources.every(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon))) ||
        !payload.targets.every(p => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))) {
      return send(res,400,{error:'INVALID_COORDINATES'});
    }
    return send(res,200,await valhallaMatrix(payload));
  } catch(error) {
    console.error('Road distance error:',error);
    return send(res,502,{error:'ROUTING_UNAVAILABLE',message:error.message});
  }
}
async function handleApi(req, res, url) {
  const placesHandled = await handlePlaces(req, res, url);
  if (placesHandled !== false) return true;
  if (url.pathname === '/api/road-distance' && (req.method === 'GET' || req.method === 'POST')) return roadDistance(req,res,url);
  if (req.method !== 'GET') return false;
  if (url.pathname === '/api/address-search') {
    const q=(url.searchParams.get('q')||'').trim(), sessionToken=(url.searchParams.get('sessionToken')||'').trim();
    if (!q) return send(res,400,{error:'EMPTY_QUERY',message:'Thiếu địa chỉ cần tìm.'});
    if (q.length<2) return send(res,400,{error:'SHORT_QUERY',message:'Hãy nhập ít nhất 2 ký tự.'});
    if (!GOGODUK_API_KEY) return send(res,503,{error:'GOGODUK_API_KEY_NOT_CONFIGURED',message:'Chưa cấu hình GoGoDuk API key.'});
    return addressSuggest(res,q,sessionToken);
  }
  if (url.pathname === '/api/address-resolve') {
    const id=(url.searchParams.get('id')||'').trim(), sessionToken=(url.searchParams.get('sessionToken')||'').trim();
    if (!id) return send(res,400,{error:'EMPTY_PLACE_ID',message:'Thiếu place ID.'});
    if (!GOGODUK_API_KEY) return send(res,503,{error:'GOGODUK_API_KEY_NOT_CONFIGURED',message:'Chưa cấu hình GoGoDuk API key.'});
    return placeResolve(res,id,sessionToken);
  }
  if (url.pathname === '/api/address-reverse') {
    const lat=Number(url.searchParams.get('lat')), lng=Number(url.searchParams.get('lng'));
    if (!Number.isFinite(lat)||!Number.isFinite(lng)) return send(res,400,{error:'INVALID_COORDINATES',message:'Tọa độ không hợp lệ.'});
    if (!GOGODUK_API_KEY) return send(res,503,{error:'GOGODUK_API_KEY_NOT_CONFIGURED',message:'Chưa cấu hình GoGoDuk API key.'});
    return addressReverse(res,lat,lng);
  }
  return false;
}

function serveStatic(req,res,url){
  let pathname=decodeURIComponent(url.pathname); if(pathname==='/') pathname='/index.html';
  const filePath=path.normalize(path.join(ROOT,pathname));
  if(!filePath.startsWith(ROOT)) return send(res,403,{error:'FORBIDDEN'});
  fs.stat(filePath,(err,stat)=>{if(!err&&stat.isDirectory())return serveFile(path.join(filePath,'index.html'),res);if(err)return serveFile(path.join(ROOT,'index.html'),res);return serveFile(filePath,res)});
}
function serveFile(filePath,res){fs.readFile(filePath,(err,data)=>{if(err)return send(res,404,{error:'NOT_FOUND'});const ext=path.extname(filePath).toLowerCase();res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});res.end(data)})}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
  if(url.pathname.startsWith('/api/')){try{const handled=await handleApi(req,res,url);if(handled!==false)return}catch(error){return send(res,502,{error:'API_UNAVAILABLE',message:error.message})}return send(res,404,{error:'NOT_FOUND'})}
  serveStatic(req,res,url);
});
server.listen(PORT,'0.0.0.0',()=>console.log(`My Place Map listening on ${PORT}`));