const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const GOGODUK_API_KEY = process.env.GOGODUK_API_KEY || '';
const GOGODUK_API = 'https://api.gogoduk.com';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
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

async function handleApi(req, res, url) {
  if (req.method !== 'GET') return false;
  if (url.pathname === '/api/address-search') {
    const q = (url.searchParams.get('q') || '').trim();
    const sessionToken = (url.searchParams.get('sessionToken') || '').trim();
    if (!q) return send(res, 400, {error: 'EMPTY_QUERY', message: 'Thiếu địa chỉ cần tìm.'});
    if (q.length < 2) return send(res, 400, {error: 'SHORT_QUERY', message: 'Hãy nhập ít nhất 2 ký tự.'});
    if (!GOGODUK_API_KEY) return send(res, 503, {error: 'GOGODUK_API_KEY_NOT_CONFIGURED', message: 'Chưa cấu hình GoGoDuk API key.'});
    return addressSuggest(res, q, sessionToken);
  }
  if (url.pathname === '/api/address-resolve') {
    const id = (url.searchParams.get('id') || '').trim();
    const sessionToken = (url.searchParams.get('sessionToken') || '').trim();
    if (!id) return send(res, 400, {error: 'EMPTY_PLACE_ID', message: 'Thiếu place ID.'});
    if (!GOGODUK_API_KEY) return send(res, 503, {error: 'GOGODUK_API_KEY_NOT_CONFIGURED', message: 'Chưa cấu hình GoGoDuk API key.'});
    return placeResolve(res, id, sessionToken);
  }
  if (url.pathname === '/api/address-reverse') {
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return send(res, 400, {error: 'INVALID_COORDINATES', message: 'Tọa độ không hợp lệ.'});
    if (!GOGODUK_API_KEY) return send(res, 503, {error: 'GOGODUK_API_KEY_NOT_CONFIGURED', message: 'Chưa cấu hình GoGoDuk API key.'});
    return addressReverse(res, lat, lng);
  }
  return false;
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return send(res, 403, {error: 'FORBIDDEN'});
  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) return serveFile(path.join(filePath, 'index.html'), res);
    if (err) return serveFile(path.join(ROOT, 'index.html'), res);
    return serveFile(filePath, res);
  });
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, {error: 'NOT_FOUND'});
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {'Content-Type': MIME[ext] || 'application/octet-stream'});
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
    } catch (error) {
      return send(res, 502, {error: 'API_UNAVAILABLE', message: error.message});
    }
    return send(res, 404, {error: 'NOT_FOUND'});
  }
  serveStatic(req, res, url);
});

server.listen(PORT, '0.0.0.0', () => console.log(`My Place Map listening on ${PORT}`));
