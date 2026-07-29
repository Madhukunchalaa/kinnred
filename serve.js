require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 4599;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const MONGODB_URI = process.env.MONGODB_URI || null;
const ADMIN_TOKEN = 'kinnred_admin_secret_auth_token_key';
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'waitlist.json');

// Ensure local data folder exists for JSON storage fallback
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(LOCAL_DB_PATH)) {
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify([]));
}

// Database Connection
let db = null;
let client = null;

if (MONGODB_URI) {
  console.log('Connecting to MongoDB Atlas...');
  MongoClient.connect(MONGODB_URI)
    .then(c => {
      client = c;
      db = client.db('kinnred');
      console.log('Successfully connected to MongoDB Atlas database: kinnred');
    })
    .catch(err => {
      console.error('Failed to connect to MongoDB Atlas. Falling back to local file storage.', err.message);
    });
} else {
  console.log('No MONGODB_URI configured. Running with local JSON database fallback.');
}

// JSON Request body parser helper
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Serve HTTP Request
http.createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const method = req.method;

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Route: Waitlist Signup Submit
  if (method === 'POST' && url === '/api/waitlist') {
    try {
      const data = await parseJsonBody(req);
      if (!data.name || !data.email || !data.city) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Missing required parameters.' }));
        return;
      }

      data.submittedAt = data.submittedAt || new Date().toISOString();
      let spotNumber = Math.floor(1000 + Math.random() * 9000);

      if (db) {
        // Save to MongoDB Atlas
        const collection = db.collection('waitlist');
        const count = await collection.countDocuments();
        spotNumber = 1001 + count; // Serial spot number starting from #1001
        data.spotNumber = spotNumber;
        await collection.insertOne(data);
        console.log(`Saved submission for ${data.name} to MongoDB Atlas.`);
      } else {
        // Save to Local JSON database file
        const fileContent = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
        const list = JSON.parse(fileContent || '[]');
        spotNumber = 1001 + list.length;
        data.spotNumber = spotNumber;
        list.push(data);
        fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(list, null, 2));
        console.log(`Saved submission for ${data.name} to local JSON file.`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, spotNumber }));
    } catch (err) {
      console.error('Waitlist submit error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Internal server error.' }));
    }
    return;
  }

  // API Route: Public waitlist count (count only — never exposes joiner details)
  if (method === 'GET' && url === '/api/waitlist/count') {
    try {
      let count;
      if (db) {
        count = await db.collection('waitlist').countDocuments();
      } else {
        const fileContent = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
        count = JSON.parse(fileContent || '[]').length;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' });
      res.end(JSON.stringify({ success: true, count }));
    } catch (err) {
      console.error('Waitlist count error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Could not read count.' }));
    }
    return;
  }

  // API Route: Admin Authentication Login
  if (method === 'POST' && url === '/api/admin/login') {
    try {
      const data = await parseJsonBody(req);
      if (data.password === ADMIN_PASSWORD) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, token: ADMIN_TOKEN }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Incorrect password.' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Server error.' }));
    }
    return;
  }

  // API Route: Fetch Dashboard Submissions
  if (method === 'GET' && url === '/api/admin/submissions') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (token !== ADMIN_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Unauthorized. Access Denied.' }));
      return;
    }

    try {
      let submissions = [];
      if (db) {
        submissions = await db.collection('waitlist').find().sort({ submittedAt: -1 }).toArray();
      } else {
        const fileContent = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
        submissions = JSON.parse(fileContent || '[]');
        // Sort descending
        submissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, submissions }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Database fetch error.' }));
    }
    return;
  }

  // Serving Static Files
  let f = url;
  if (f === '/' || f === '/index' || f === '/index.html') f = '/index.html';
  if (f === '/privacy' || f === '/privacy.html') f = '/privacy.html';
  if (f === '/terms' || f === '/terms.html') f = '/terms.html';
  if (f === '/admin' || f === '/admin.html') f = '/admin.html';

  const resolvedPath = path.join(__dirname, f);

  // Security check: ensure file remains within project directory
  if (!resolvedPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Access Denied');
    return;
  }

  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('File Not Found');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentTypeMap = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'text/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.ico': 'image/x-icon'
    };

    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Kinnred production-ready server listening on port ${PORT}`);
});
