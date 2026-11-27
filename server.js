'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const url = require('url');

const { PureWebSocketServer } = require('./server_modules/ws_server');
const { ConfigLoader } = require('./server_modules/config_loader');
const { PackId } = require('./server_modules/opcodes');
const cipher = require('./server_modules/cipher');
const { createHeroState } = require('./server_modules/session_state');
const handlersLogin = require('./server_modules/handlers_login');
const handlersWorld = require('./server_modules/handlers_world');
const handlersInventory = require('./server_modules/handlers_inventory');
const handlersSystems = require('./server_modules/handlers_systems');

const PORT = Number(process.env.PORT || 8899);
const LEGACY_WS_PORT = Number(process.env.WS_PORT || 0); // optional extra WS listener if requested
const CDN_ROOT = path.join(__dirname, 'zy2saga-cdn.gamehollywood.com', 'yingwen', 'entrance');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.zip': 'application/zip',
  '.fnt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.exml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
};

console.log('[IdleSaga] Loading game configs and map data from CDN mirror...');
const configLoader = new ConfigLoader(CDN_ROOT).loadAll();
console.log(`[IdleSaga] Loaded ${Object.keys(configLoader.cfgs).length} config tables, ${Object.keys(configLoader.maps).length} map grids.`);

class AccountStore {
  constructor() {
    this.accounts = new Map();
    this.userMode = new Map();
    this._actorSeq = 10001;
    this.defaultPreset = 'default';
  }

  getAccountId(user) {
    let hash = 1000;
    for (let i = 0; i < user.length; i++) hash = (hash * 31 + user.charCodeAt(i)) % 900000;
    return hash + 100000;
  }

  ensurePresetMode(user, mode) {
    this.userMode.set(user, mode);
    if (mode === 'create') {
      this.accounts.set(user, []);
      return [];
    }
    const existing = this.accounts.get(user);
    if (existing && existing.length > 0 && existing[0]._preset === mode) {
      return existing;
    }
    const st = createHeroState(configLoader, {
      actorId: this.nextActorId(),
      preset: mode === 'high' ? 'high' : 'default',
      name: mode === 'high' ? 'Overlord' : 'Adventurer',
    });
    st._preset = mode;
    this.accounts.set(user, [st]);
    return [st];
  }

  getRoles(user) {
    if (!this.accounts.has(user)) {
      this.ensurePresetMode(user, this.userMode.get(user) || 'default');
    }
    return this.accounts.get(user);
  }

  addRole(user, st) {
    const list = this.accounts.get(user) || [];
    list.push(st);
    this.accounts.set(user, list);
  }

  findRole(user, actorId) {
    const list = this.getRoles(user);
    return list.find((r) => r.actorId === actorId) || list[0] || null;
  }

  nextActorId() {
    return this._actorSeq++;
  }
}

const accounts = new AccountStore();

function resolveCdnFile(relUrl) {
  const safeRel = path.normalize(relUrl).replace(/^(\.\.[\/\\])+/, '');
  const tryCandidates = [path.join(CDN_ROOT, safeRel)];

  // Rewrite ver/<v>/<tail> -> fallback ver/0/<tail>, res/ <-> res_a/, and 545.json manifest versions
  const verMatch = safeRel.match(/^ver[\/\\]([^\/\\]+)[\/\\](.+)$/);
  if (verMatch) {
    const vNum = verMatch[1];
    const tail = verMatch[2];
    const normTail = tail.replace(/\\/g, '/');
    const aNormTail = /^res\//i.test(normTail) ? 'res_a/' + normTail.slice(4) : null;

    if (vNum !== '0') {
      tryCandidates.push(path.join(CDN_ROOT, 'ver', '0', tail));
    }
    if (aNormTail) {
      tryCandidates.push(path.join(CDN_ROOT, 'ver', vNum, aNormTail));
      if (vNum !== '0') tryCandidates.push(path.join(CDN_ROOT, 'ver', '0', aNormTail));
    }
    for (const key of [normTail, aNormTail]) {
      if (!key) continue;
      const mVer = configLoader.verManifest[key];
      if (mVer !== undefined && String(mVer) !== vNum) {
        tryCandidates.push(path.join(CDN_ROOT, 'ver', String(mVer), normTail));
        tryCandidates.push(path.join(CDN_ROOT, 'ver', String(mVer), key));
      }
    }
  }

  for (const full of tryCandidates) {
    if (!full.startsWith(CDN_ROOT)) continue;
    try {
      const st = fs.statSync(full);
      if (st.isFile()) return full;
    } catch (_) {}
  }
  return null;
}

function sendJson(res, obj, statusCode = 200) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function servePortalHtml(res, port) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Idle Saga — Offline Local Server</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; font-family: "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(circle at top, #21163a 0%, #0b0d17 65%, #06070d 100%);
    color: #f4efe6; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
  }
  header {
    width: 100%; max-width: 1120px; padding: 18px 24px 8px; box-sizing: border-box;
    display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  }
  .brand h1 { margin: 0; font-size: 22px; letter-spacing: 0.4px; color: #ffd97d; }
  .brand p { margin: 2px 0 0; font-size: 13px; color: #a7b0c7; }
  .controls { display: flex; gap: 10px; flex-wrap: wrap; }
  button, a.btn {
    background: linear-gradient(135deg, #d97706, #b45309); border: 1px solid #fbbf24;
    color: #fff; font-weight: 600; font-size: 13px; padding: 9px 15px; border-radius: 8px;
    cursor: pointer; text-decoration: none; transition: transform .1s ease, filter .15s ease;
  }
  button.secondary, a.btn.secondary {
    background: rgba(30, 41, 59, 0.85); border-color: #475569; color: #e2e8f0;
  }
  button:hover, a.btn:hover { filter: brightness(1.1); transform: translateY(-1px); }
  .frame-wrap {
    width: 100%; max-width: 540px; flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 8px 16px 20px; box-sizing: border-box;
  }
  iframe {
    width: 100%; height: 84vh; min-height: 680px; border: 2px solid #2d3550; border-radius: 14px;
    background: #000; box-shadow: 0 24px 70px rgba(0, 0, 0, 0.75);
  }
</style>
</head>
<body>
  <header>
    <div class="brand">
      <h1>Idle Saga Offline</h1>
      <p>Local HTTP + Binary WebSocket Emulator (127.0.0.1:${port})</p>
    </div>
    <div class="controls">
      <button onclick="launch('default')">Lv1 Hero (Play)</button>
      <button class="secondary" onclick="launch('create')">Create New Hero</button>
      <button class="secondary" onclick="launch('high')">High-Level VIP Preset</button>
      <a class="btn secondary" id="directLink" href="/yingwen/entrance/zycs_yingwen_zy2saga.html?pfId=zy2saga&uid=commander&server_id=1&ts=1700000000&signature=offline">Fullscreen Client</a>
    </div>
  </header>
  <div class="frame-wrap">
    <iframe id="gameFrame" title="Idle Saga Client" allowfullscreen></iframe>
  </div>
  <script>
    function buildUrl(mode) {
      var u = '/yingwen/entrance/zycs_yingwen_zy2saga.html?pfId=zy2saga&uid=commander&server_id=1&ts=' + Math.floor(Date.now() / 1000) + '&signature=offline&mode=' + encodeURIComponent(mode);
      return u;
    }
    function launch(mode) {
      var url = buildUrl(mode);
      document.getElementById('directLink').href = url;
      document.getElementById('gameFrame').src = url;
    }
    var params = new URLSearchParams(location.search);
    var preset = params.get('preset') === 'high' ? 'high' : (params.get('create') === '1' ? 'create' : 'default');
    launch(preset);
  </script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || '/');
  const q = parsed.query || {};
  const hostHeader = req.headers.host || `127.0.0.1:${PORT}`;
  const reqPort = Number((hostHeader.split(':')[1]) || PORT);

  // Consume POST bodies gracefully
  if (req.method === 'POST' || req.method === 'OPTIONS') {
    req.on('data', () => {});
    req.on('end', () => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
        res.end();
        return;
      }
      sendJson(res, { code: 1, status: 1, msg: 'ok' });
    });
    return;
  }

  // 1. Portal / Launch page / Favicon
  if (pathname === '/' || pathname === '/index.html') {
    servePortalHtml(res, reqPort);
    return;
  }

  if (pathname === '/favicon.ico') {
    const iconCandidate = path.join(CDN_ROOT, 'ver', '0', 'icon', 'shareicon.png');
    if (fs.existsSync(iconCandidate)) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      fs.createReadStream(iconCandidate).pipe(res);
    } else {
      const png1x1 = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      );
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      res.end(png1x1);
    }
    return;
  }

  // 2. HTTP Login / Version / Server List / Config endpoints
  if (pathname.endsWith('/api/entryVersion') || pathname.endsWith('/api/clientVersion')) {
    sendJson(res, {
      entry_version: '541',
      engine_version: 0,
      default_v: 0,
      client_version: 545,
    });
    return;
  }

  if (pathname.endsWith('/api/privacyStatus')) {
    sendJson(res, { privacy_status: 0 });
    return;
  }

  if (pathname.endsWith('/api/clientConf')) {
    sendJson(res, { flash_version: '0', engine_version: '545', packet_version: '0' });
    return;
  }

  if (pathname.endsWith('/api/notice')) {
    sendJson(res, { notice: 'Welcome to Idle Saga Offline!' });
    return;
  }

  if (pathname.endsWith('/api/ybStatus')) {
    sendJson(res, { code: 1, status: 1 });
    return;
  }

  if (pathname.endsWith('/api/isFilters')) {
    sendJson(res, { isFilters: '0' });
    return;
  }

  if (pathname.endsWith('/api/wxIosPayStatus')) {
    sendJson(res, '0');
    return;
  }

  if (pathname.includes('/login/serverlabel') || pathname.includes('/login/wxserverlabel')) {
    const uid = String(q.uid || q.openId || 'commander');
    sendJson(res, {
      code: 200,
      openId: uid,
      isnew: 0,
      label_list: [{ label_id: '1', name: 'S1-S10', start: 1, end: 10 }],
      lastserver: {
        default_server: { server_id: '1', name: 'S1 Offline', server_status: '2' },
        last_server: [{ server_id: '1', name: 'S1 Offline', server_status: '2' }],
        total_page: 1,
      },
    });
    return;
  }

  if (pathname.includes('/login/getserverlist') || pathname.includes('/login/wxgetserverlist')) {
    sendJson(res, {
      serverlist: [{ server_id: '1', name: 'S1 Offline', server_status: '2' }],
    });
    return;
  }

  if (pathname.includes('/login/getlogininfo')) {
    const uid = String(q.uid || q.openId || 'commander');
    let mode = 'default';
    if (req.headers.referer) {
      try {
        const refQ = url.parse(req.headers.referer, true).query;
        if (refQ.mode === 'high' || refQ.preset === 'high') mode = 'high';
        else if (refQ.mode === 'create' || refQ.create === '1') mode = 'create';
      } catch (_) {}
    }
    const roles = accounts.ensurePresetMode(uid, mode);
    const roleCount = roles.length;
    const isnew = roleCount === 0 ? 1 : 0;
    const srvId = String(q.server_id || q.serverid || '1');
    const now = Math.floor(Date.now() / 1000);
    const nick = roles[0] ? roles[0].name : uid;
    const wsPort = LEGACY_WS_PORT || reqPort;
    const flashUrl = `?srvid=${srvId}&user=${encodeURIComponent(uid)}&spverify=offline_sig&newbie=${isnew}&serverid=${srvId}&login_ip=127.0.0.1&srvtime=${now}&pfid=7601&pf=zy2saga&loadurl=http://${hostHeader}&isBan=0&roleCount=${roleCount}&nickname=${encodeURIComponent(nick)}&isnew=${isnew}&srvaddr=127.0.0.1&srvport=${wsPort}&appid=7601&v=545&crtr=0&welc=0&via=7601&hosts=./`;

    sendJson(res, {
      code: 1,
      hosts: './',
      pfhost: '',
      v: 545,
      default_v: 0,
      appId: 7601,
      openId: uid,
      openKey: 'offline',
      serverId: srvId,
      serverName: 'S1 Offline',
      loginFlag: 1,
      gameNotice: '',
      isnew,
      isback: false,
      bg_ver: '',
      logo: 7601,
      payItems: [],
      pName: 'zy2saga',
      nickName: nick,
      flashUrl,
    });
    return;
  }

  if (pathname.startsWith('/report') || pathname.includes('/api/report') || pathname.includes('/roleReport')) {
    sendJson(res, 'true');
    return;
  }

  // 3. Mirrored game client HTML + Static CDN assets
  let relAsset = null;
  if (pathname.startsWith('/yingwen/entrance/')) {
    relAsset = pathname.slice('/yingwen/entrance/'.length);
  } else {
    relAsset = pathname.replace(/^\/+/, '');
  }

  // Rewrite domain in zycs_yingwen_zy2saga.html so it talks ONLY to local server
  if (relAsset === 'zycs_yingwen_zy2saga.html') {
    const fullHtml = resolveCdnFile(relAsset);
    if (fullHtml) {
      let html = fs.readFileSync(fullHtml, 'utf8');
      html = html.replace(
        /https:\/\/zy2saga-login\.gamehollywood\.com\//g,
        `http://${hostHeader}/`
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html);
      return;
    }
  }

  const diskFile = resolveCdnFile(relAsset);
  if (diskFile) {
    const ext = path.extname(diskFile).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    });
    fs.createReadStream(diskFile).pipe(res);
    return;
  }

  console.warn(`[HTTP 404] ${req.method} ${pathname}`);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found: ' + pathname);
});

function attachGameWsServer(httpSrv) {
  const wss = new PureWebSocketServer((ws) => {
    const ctx = {
      ws,
      handshakeStage: 0,
      selfSalt: 0,
      targetSalt: cipher.makeTargetSalt(),
      keyBuff: null,
      rxBuf: Buffer.alloc(0),
      user: 'commander',
      st: null,
      accounts,
      configLoader,
      handlersWorld,
      handlersInventory,
      handlersSystems,
      sendPacket(sysId, msgId, payload) {
        const frame = cipher.buildServerFrame(sysId, msgId, payload);
        ws.send(frame);
      },
    };

    ws.on('message', (msg) => {
      try {
        if (ctx.handshakeStage === 0) {
          if (msg.length < 4) return;
          ctx.selfSalt = msg.readUInt32LE(0);
          const derived = cipher.deriveKey(ctx.selfSalt, ctx.targetSalt);
          ctx.keyBuff = derived.keyBuff;
          ctx.expectedCheck = derived.expectedCheck;
          ctx.expectedCheckSigned = derived.expectedCheckSigned;
          ctx.handshakeStage = 1;

          const reply = Buffer.allocUnsafe(4);
          reply.writeUInt32LE(ctx.targetSalt >>> 0, 0);
          ws.send(reply);
          return;
        }

        if (ctx.handshakeStage === 1) {
          if (msg.length < 2) return;
          const clientCheckSigned = msg.readInt16LE(0);
          if (clientCheckSigned !== ctx.expectedCheckSigned) {
            console.warn(`[WS] Handshake CRC mismatch: got=${clientCheckSigned}, expected=${ctx.expectedCheckSigned}`);
          }
          ctx.handshakeStage = 2;
          if (msg.length > 2) {
            ctx.rxBuf = Buffer.concat([ctx.rxBuf, msg.subarray(2)]);
          } else {
            return;
          }
        } else {
          ctx.rxBuf = Buffer.concat([ctx.rxBuf, msg]);
        }

        const { packets, rest } = cipher.parseClientFrames(ctx.rxBuf, ctx.keyBuff);
        ctx.rxBuf = rest;

        for (const pkt of packets) {
          const { sysId, msgId, payload } = pkt;
          if (sysId === PackId.Login) {
            handlersLogin.handleLoginPacket(ctx, msgId, payload);
          } else if (sysId === PackId.Default) {
            handlersWorld.handleDefaultPacket(ctx, msgId, payload);
          } else if (sysId === PackId.Skill) {
            handlersWorld.handleSkillPacket(ctx, msgId, payload);
          } else if (sysId === PackId.Fuben || sysId === PackId.Fuben2) {
            handlersWorld.handleFubenPacket(ctx, msgId, payload);
          } else if (sysId === PackId.Config) {
            handlersWorld.handleConfigPacket(ctx, msgId, payload);
          } else if (sysId === PackId.Bag) {
            handlersInventory.handleBagPacket(ctx, msgId, payload);
          } else if (sysId === PackId.Equip) {
            handlersInventory.handleEquipPacket(ctx, msgId, payload);
          } else if (sysId === PackId.Forge) {
            handlersInventory.handleForgePacket(ctx, msgId, payload);
          } else if (sysId === PackId.Shop) {
            handlersInventory.handleShopPacket(ctx, msgId, payload);
          } else {
            handlersSystems.handleSystemsPacket(ctx, sysId, msgId, payload);
          }
        }
      } catch (err) {
        console.error('[WS Packet Error]', err);
      }
    });

    ws.on('close', () => {
      if (ctx._monAiTimer) {
        clearInterval(ctx._monAiTimer);
        ctx._monAiTimer = null;
      }
    });
  });

  wss.attach(httpSrv);
}

attachGameWsServer(server);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[IdleSaga] Offline Server listening at http://127.0.0.1:${PORT}/`);
});

if (LEGACY_WS_PORT && LEGACY_WS_PORT !== PORT) {
  const wsOnlySrv = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Idle Saga WS');
  });
  attachGameWsServer(wsOnlySrv);
  wsOnlySrv.listen(LEGACY_WS_PORT, '127.0.0.1', () => {
    console.log(`[IdleSaga] Extra WS listener on 127.0.0.1:${LEGACY_WS_PORT}`);
  });
}
