const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';

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
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function placesSearch(res, query) {
  if (!GOOGLE_API_KEY) {
    return send(res, 503, {
      error: 'GOOGLE_MAPS_API_KEY_NOT_CONFIGURED',
      message: 'Google Places API chưa được cấu hình trên server.'
    });
  }

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri'
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'vi',
      regionCode: 'VN',
      pageSize: 8
    })
  });

  const data = await response.json();
  if (!response.ok) {
    return send(res, response.status, {
      error: 'GOOGLE_PLACES_ERROR',
      message: data?.error?.message || 'Google Places search failed.'
    });
  }

  return send(res, 200, {
    source: 'google-places',
    places: (data.places || []).map(place => ({
      id: place.id || '',
      name: place.displayName?.text || '',
      address: place.formattedAddress || '',
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      googleMapsUri: place.googleMapsUri || ''
    }))
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/places-search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) return send(res, 400, { error: 'EMPTY_QUERY', message: 'Thiếu địa chỉ cần tìm.' });
    try {
      return await placesSearch(res, q);
    } catch (error) {
      return send(res, 502, { error: 'GOOGLE_PLACES_UNAVAILABLE', message: error.message });
    }
  }
  return false;
}

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) return send(res, 403, { error: 'FORBIDDEN' });

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      return serveFile(path.join(filePath, 'index.html'), res);
    }
    if (err) return serveFile(path.join(ROOT, 'index.html'), res);
    return serveFile(filePath, res);
  });
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: 'NOT_FOUND' });
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, url);
    if (handled !== false) return;
    return send(res, 404, { error: 'NOT_FOUND' });
  }
  serveStatic(req, res, url);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`My Place Map listening on ${PORT}`);
});
