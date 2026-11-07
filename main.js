// Ram Calendar(구 예람달력) — 구글 캘린더 연동 바탕화면 달력 (Electron main process)
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, safeStorage, screen, session, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
// 이름을 Ram Calendar로 바꿔도 예전 설정·로그인(예람달력 폴더)을 그대로 쓰도록 저장 위치 고정
try { app.setPath('userData', path.join(app.getPath('appData'), '예람달력')); } catch {}
const APP_NAME = 'Ram Calendar';
// 윈도우 11(22H2 이상)이면 바탕화면이 비치는 진짜 유리(아크릴) 효과 사용
const ACRYLIC = process.platform === 'win32' && Number((os.release().split('.')[2]) || 0) >= 22621;

const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

let win = null;
let settingsWin = null, settingsDone = false;
let tray = null;
let quitting = false;

// ---------- 설정 저장 ----------
const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const DEFAULTS = {
  clientId: '', clientSecret: '', refreshToken: '',
  hiddenCalendars: [], opacity: 1, theme: 'system',
  alwaysOnTop: false, locked: false, autoStart: false,
  weekStart: 0, panelOpen: true, panelMode: 'day', bounds: null
};
let cfg = { ...DEFAULTS };
// 배포판에 함께 넣는 기본 구글 키(빌드할 때 creds.json으로 들어감). 설정에서 직접 넣은 키가 있으면 그걸 우선 사용
let BUILTIN = { clientId: '', clientSecret: '' };
try { BUILTIN = { ...BUILTIN, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'creds.json'), 'utf8')) }; } catch {}
const clientId = () => cfg.clientId || BUILTIN.clientId;
const clientSecret = () => (cfg.clientId ? cfg.clientSecret : BUILTIN.clientSecret);
function loadCfg() {
  try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) }; } catch { cfg = { ...DEFAULTS }; }
}
function saveCfg() {
  try { fs.mkdirSync(path.dirname(cfgPath()), { recursive: true }); fs.writeFileSync(cfgPath(), JSON.stringify(cfg, null, 2)); } catch (e) { console.error(e); }
}
function enc(s) {
  if (!s) return '';
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64'); } catch {}
  return 'raw:' + Buffer.from(s).toString('base64');
}
function dec(s) {
  if (!s) return '';
  try {
    if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
    if (s.startsWith('raw:')) return Buffer.from(s.slice(4), 'base64').toString();
  } catch {}
  return '';
}
function publicCfg() {
  const { refreshToken, clientSecret, aiKey, ...rest } = cfg;
  return { ...rest, hasSecret: !!clientSecret, hasAiKey: !!aiKey, loggedIn: !!refreshToken, acrylic: ACRYLIC, builtIn: !!(BUILTIN.clientId && BUILTIN.clientSecret), version: app.getVersion() };
}

// ---------- 구글 로그인 (PKCE + 루프백) ----------
let accessToken = null, accessExp = 0;
function b64url(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

function login() {
  return new Promise((resolve, reject) => {
    if (!clientId() || !clientSecret()) return reject(new Error('NO_CLIENT'));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    let done = false;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      const page = (msg) => `<!doctype html><meta charset="utf-8"><title>Ram Calendar</title><body style="font-family:'Malgun Gothic',sans-serif;padding:40px;font-size:18px">${msg}</body>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (err || !code || u.searchParams.get('state') !== state) {
        res.end(page('로그인이 취소됐어요. Ram Calendar에서 다시 시도해 주세요.'));
        finish(new Error(err || 'LOGIN_FAILED'));
        return;
      }
      try {
        const port = server.address().port;
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code, client_id: clientId(), client_secret: clientSecret(),
            redirect_uri: `http://127.0.0.1:${port}`, grant_type: 'authorization_code', code_verifier: verifier
          })
        });
        const j = await r.json();
        if (!r.ok || !j.refresh_token) throw new Error(j.error_description || j.error || 'NO_REFRESH_TOKEN');
        cfg.refreshToken = enc(j.refresh_token); saveCfg();
        accessToken = j.access_token; accessExp = Date.now() + (j.expires_in - 60) * 1000;
        res.end(page('✅ 로그인 완료! 이 창을 닫고 Ram Calendar로 돌아가세요.'));
        finish(null);
      } catch (e) {
        res.end(page('로그인 중 문제가 생겼어요: ' + String(e.message).replace(/</g, '&lt;')));
        finish(e);
      }
    });
    const timer = setTimeout(() => finish(new Error('TIMEOUT')), 5 * 60 * 1000);
    function finish(e) {
      if (done) return; done = true; clearTimeout(timer);
      setTimeout(() => server.close(), 500);
      if (win) { win.show(); win.focus(); }
      e ? reject(e) : resolve(true);
    }
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: clientId(), redirect_uri: `http://127.0.0.1:${port}`, response_type: 'code',
        scope: SCOPE, access_type: 'offline', prompt: 'consent', code_challenge: challenge,
        code_challenge_method: 'S256', state
      });
      shell.openExternal(url);
    });
  });
}

async function token() {
  if (accessToken && Date.now() < accessExp) return accessToken;
  const rt = dec(cfg.refreshToken);
  if (!rt) throw Object.assign(new Error('NOT_LOGGED_IN'), { code: 'NOT_LOGGED_IN' });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), refresh_token: rt, grant_type: 'refresh_token' })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') { cfg.refreshToken = ''; saveCfg(); throw Object.assign(new Error('로그인이 만료됐어요. 설정에서 다시 로그인해 주세요.'), { code: 'NOT_LOGGED_IN' }); }
    throw Object.assign(new Error(j.error_description || j.error || '토큰 갱신 실패'), { code: 'TOKEN' });
  }
  accessToken = j.access_token; accessExp = Date.now() + (j.expires_in - 60) * 1000;
  return accessToken;
}

async function api(method, p, query, body) {
  const t = await token();
  const url = API + p + (query ? '?' + new URLSearchParams(query) : '');
  const r = await fetch(url, {
    method, headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) { accessToken = null; }
    throw Object.assign(new Error((j.error && j.error.message) || ('HTTP ' + r.status)), { code: 'API_' + r.status });
  }
  return j;
}
const enc1 = encodeURIComponent;

// ---------- 메모·칸 색 동기화 ----------
// 새 권한 없이, 내 기본 캘린더의 2000-01-01 숨은 일정 하나에 JSON으로 저장한다(어느 컴퓨터든 같은 구글 계정이면 같은 메모).
const SYNC_KEYS = ['notes', 'dayColors', 'dayBorders', 'dayEmojis'];
let syncEventId = null, pushTimer = null;
async function findSyncEvent() {
  const r = await api('GET', '/calendars/primary/events', { privateExtendedProperty: 'ramcal=sync', timeMin: '1999-12-01T00:00:00Z', timeMax: '2000-02-01T00:00:00Z', singleEvents: 'true', maxResults: '5' });
  return (r.items || [])[0] || null;
}
async function pushSync() {
  clearTimeout(pushTimer); pushTimer = null;
  if (!cfg.refreshToken) return;
  const data = { v: 1, at: cfg.syncAt || Date.now() };
  SYNC_KEYS.forEach(k => { data[k] = cfg[k] || (k === 'notes' ? [] : {}); });
  const body = { summary: 'Ram Calendar 메모 동기화 (지우지 마세요)', description: JSON.stringify(data), start: { date: '2000-01-01' }, end: { date: '2000-01-02' },
    transparency: 'transparent', visibility: 'private', extendedProperties: { private: { ramcal: 'sync' } } };
  if (!syncEventId) { const ev = await findSyncEvent(); if (ev) syncEventId = ev.id; }
  if (syncEventId) {
    try { await api('PATCH', `/calendars/primary/events/${enc1(syncEventId)}`, null, body); return; }
    catch (e) { if (!/404|410/.test(e.code || '')) throw e; syncEventId = null; }
  }
  const ev = await api('POST', '/calendars/primary/events', null, body); syncEventId = ev.id;
}
async function pullSync() {
  if (!cfg.refreshToken) return false;
  const ev = await findSyncEvent();
  if (!ev) { if (SYNC_KEYS.some(k => cfg[k] && Object.keys(cfg[k]).length)) { cfg.syncAt = cfg.syncAt || Date.now(); await pushSync(); } return false; }
  syncEventId = ev.id;
  let data = {}; try { data = JSON.parse(ev.description || '{}'); } catch {}
  const remoteAt = +data.at || 0, localAt = +cfg.syncAt || 0;
  if (remoteAt > localAt) { SYNC_KEYS.forEach(k => { if (k in data) cfg[k] = data[k]; }); cfg.syncAt = remoteAt; saveCfg(); return true; }
  if (localAt > remoteAt) await pushSync();
  return false;
}
function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(() => pushSync().catch(() => {}), 1500); }

// ---------- 데스크탑 알림 (오른쪽 아래 팝업) ----------
// 구글 캘린더의 알림과 따로, 이 컴퓨터에서만 울린다. 핸드폰은 조용.
// 일정마다 extendedProperties.private.ramAlarm 에 분 단위(또는 'off')를 저장해 두면 그 값을, 없으면 설정의 기본값을 쓴다.
let alarmEvents = [], alarmWins = [], alarmSnoozed = [], alarmTimer = null, alarmFetchTimer = null;
const alarmOn = () => cfg.alarm !== false;
const alarmDefault = () => (cfg.alarmMinutes == null ? 30 : Number(cfg.alarmMinutes));
function alarmFired() { if (!Array.isArray(cfg.alarmFired)) cfg.alarmFired = []; return cfg.alarmFired; }
function eventAlarmMinutes(e) {
  const p = e.extendedProperties && e.extendedProperties.private;
  if (p && p.ramAlarm != null && p.ramAlarm !== '') return p.ramAlarm === 'off' ? null : Number(p.ramAlarm);
  return alarmDefault();
}
function declined(e) { return (e.attendees || []).some(a => a.self && a.responseStatus === 'declined'); }
async function fetchAlarmEvents() {
  if (!cfg.refreshToken || !alarmOn()) { alarmEvents = []; return; }
  const cl = await api('GET', '/users/me/calendarList', { maxResults: 250 });
  const hidden = new Set(cfg.hiddenCalendars || []);
  const cals = (cl.items || []).filter(c => !hidden.has(c.id) && !/#holiday@/.test(c.id));
  const now = Date.now(), tmin = new Date(now - 3 * 3600e3).toISOString(), tmax = new Date(now + 26 * 3600e3).toISOString();
  const out = [];
  await Promise.all(cals.map(async (c) => {
    try {
      const j = await api('GET', `/calendars/${enc1(c.id)}/events`, { timeMin: tmin, timeMax: tmax, singleEvents: 'true', orderBy: 'startTime', maxResults: 250 });
      (j.items || []).forEach(e => {
        if (e.status === 'cancelled' || !e.start || !e.start.dateTime || declined(e)) return;
        out.push({ id: e.id, title: e.summary || '', location: e.location || '', start: Date.parse(e.start.dateTime), end: e.end && e.end.dateTime ? Date.parse(e.end.dateTime) : 0,
          minutes: eventAlarmMinutes(e), calName: c.summaryOverride || c.summary || '', color: c.backgroundColor || '' });
      });
    } catch (e) { if (e.code === 'NOT_LOGGED_IN') throw e; }
  }));
  alarmEvents = out; checkAlarms();
}
function checkAlarms() {
  if (!alarmOn()) return;
  const now = Date.now(), fired = alarmFired();
  for (const e of alarmEvents) {
    if (e.minutes == null) continue;
    const at = e.start - e.minutes * 60000, key = e.id + '|' + e.start + '|' + e.minutes;
    if (fired.includes(key)) continue;
    // 정해진 때가 됐고, 일정이 아직 안 지났으면(시작 후 10분까지) 띄운다 — 컴퓨터를 늦게 켜도 놓친 알림이 뜬다
    if (now >= at && now < e.start + 10 * 60000) { fired.push(key); showAlarm(e, key); }
  }
  alarmSnoozed = alarmSnoozed.filter(s => { if (now >= s.at) { showAlarm(s.e, s.key); return false; } return true; });
  if (fired.length > 300) cfg.alarmFired = fired.slice(-200);
  saveCfg();
}
function layoutAlarms() {
  const wa = screen.getPrimaryDisplay().workArea, W = 372, H = 150, gap = 4;
  alarmWins.forEach((w, i) => { if (!w.isDestroyed()) w.setBounds({ x: wa.x + wa.width - W - 8, y: wa.y + wa.height - (H + gap) * (i + 1) - 4, width: W, height: H }); });
}
function showAlarm(e, key) {
  if (alarmWins.length >= 4) { const old = alarmWins.shift(); if (old && !old.isDestroyed()) old.close(); }
  const d = { key, title: e.title, location: e.location, start: e.start, end: e.end, calName: e.calName, color: e.color, dark: nativeTheme.shouldUseDarkColors, sound: cfg.alarmSound !== false };
  const w = new BrowserWindow({ width: 372, height: 150, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false, hasShadow: false, title: 'Ram Calendar 알림',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
  w._alarm = { e, key };
  try { w.setAlwaysOnTop(true, 'screen-saver'); } catch {}
  w.loadFile(path.join(__dirname, 'renderer', 'alarm.html'), { query: { d: JSON.stringify(d) } });
  w.once('ready-to-show', () => { layoutAlarms(); w.showInactive(); });
  w.on('closed', () => { alarmWins = alarmWins.filter(x => x !== w); layoutAlarms(); });
  alarmWins.unshift(w); layoutAlarms();
}
ipcMain.handle('alarm:act', wrap(async (key, act, minutes) => {
  const w = alarmWins.find(x => x._alarm && x._alarm.key === key);
  const info = w && w._alarm;
  if (act === 'snooze' && info) alarmSnoozed.push({ e: info.e, key: info.key, at: Date.now() + (Number(minutes) || 5) * 60000 });
  if (act === 'open' && win && info) { win.show(); win.focus(); const t = new Date(info.e.start); win.webContents.send('app:goto', t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')); }
  if (w && !w.isDestroyed()) w.close();
}));
function startAlarms() {
  clearInterval(alarmTimer); clearInterval(alarmFetchTimer);
  alarmTimer = setInterval(checkAlarms, 20 * 1000);
  alarmFetchTimer = setInterval(() => fetchAlarmEvents().catch(() => {}), 5 * 60 * 1000);
  setTimeout(() => fetchAlarmEvents().catch(() => {}), 3000);
}
function testAlarm() {
  const now = Date.now();
  showAlarm({ id: 'test', title: '🖥[회의] 알림 미리 보기', location: '3층 회의실', start: now + alarmDefault() * 60000, end: now + (alarmDefault() + 60) * 60000, calName: '', color: '#4f6bed' }, 'test|' + now);
}

// ---------- IPC ----------
function wrap(fn) {
  return async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (e) { return { ok: false, code: e.code || 'ERR', message: e.message }; }
  };
}

ipcMain.handle('cfg:get', wrap(async () => publicCfg()));
ipcMain.handle('cfg:set', wrap(async (patch) => {
  const allowed = ['clientId', 'clientSecret', 'hiddenCalendars', 'opacity', 'theme', 'alwaysOnTop', 'locked', 'autoStart', 'weekStart', 'panelOpen', 'panelMode', 'fontFamily', 'fontSize', 'accent', 'bgColor', 'style', 'hoverZoom', 'scene', 'glassSeeThrough', 'dayColors', 'dayBorders', 'dayEmojis', 'notes', 'footOpen', 'skin3d', 'skinFlat', 'alarm', 'alarmMinutes', 'alarmSound', 'bgImage', 'bgImageDark', 'bgImageDim'];
  for (const k of Object.keys(patch || {})) if (allowed.includes(k)) cfg[k] = patch[k];
  if ('clientId' in patch || 'clientSecret' in patch) { cfg.clientId = String(cfg.clientId || '').trim(); cfg.clientSecret = String(cfg.clientSecret || '').trim(); }
  if (SYNC_KEYS.some(k => k in (patch || {}))) { cfg.syncAt = Date.now(); schedulePush(); }
  if (['alarm', 'alarmMinutes', 'hiddenCalendars'].some(k => k in (patch || {}))) fetchAlarmEvents().catch(() => {});
  saveCfg(); applyWindowCfg();
  return publicCfg();
}));
ipcMain.handle('gcal:muteDefaults', wrap(async () => {
  // 내 캘린더(소유)의 '기본 알림'을 비워서, 앞으로 만드는 일정이 핸드폰에서 울리지 않게 한다
  const cl = await api('GET', '/users/me/calendarList', { maxResults: 250, minAccessRole: 'owner' });
  let n = 0;
  for (const c of (cl.items || [])) {
    if (c.defaultReminders && c.defaultReminders.length) { await api('PATCH', `/users/me/calendarList/${enc1(c.id)}`, null, { defaultReminders: [] }); n++; }
  }
  return n;
}));
ipcMain.handle('sync:pull', wrap(async () => ({ changed: await pullSync(), cfg: publicCfg() })));
ipcMain.handle('auth:login', wrap(async () => { await login(); fetchAlarmEvents().catch(() => {}); if (win) { win.webContents.send('app:cfg'); win.webContents.send('app:refresh'); } return publicCfg(); }));
ipcMain.handle('auth:logout', wrap(async () => {
  const rt = dec(cfg.refreshToken);
  if (rt) fetch('https://oauth2.googleapis.com/revoke?token=' + enc1(rt), { method: 'POST' }).catch(() => {});
  cfg.refreshToken = ''; accessToken = null; saveCfg(); return publicCfg();
}));

ipcMain.handle('cal:list', wrap(async () => {
  const j = await api('GET', '/users/me/calendarList', { maxResults: 250 });
  return (j.items || []).map(c => ({
    id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor, primary: !!c.primary,
    writable: c.accessRole === 'owner' || c.accessRole === 'writer', timeZone: c.timeZone
  }));
}));

ipcMain.handle('ev:list', wrap(async (calIds, timeMin, timeMax) => {
  const out = []; const errors = [];
  await Promise.all(calIds.map(async (id) => {
    try {
      let pageToken;
      do {
        const q = { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: 2500 };
        if (pageToken) q.pageToken = pageToken;
        const j = await api('GET', `/calendars/${enc1(id)}/events`, q);
        (j.items || []).forEach(e => { if (e.status !== 'cancelled') out.push({ ...e, _cal: id }); });
        pageToken = j.nextPageToken;
      } while (pageToken);
    } catch (e) { if (e.code === 'NOT_LOGGED_IN') throw e; errors.push({ id, message: e.message }); }
  }));
  return { items: out, errors };
}));

ipcMain.handle('ev:search', wrap(async (calIds, q, timeMin, timeMax) => {
  const out = [];
  await Promise.all(calIds.map(async (id) => {
    try {
      const j = await api('GET', `/calendars/${enc1(id)}/events`, { q, timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: 100 });
      (j.items || []).forEach(e => out.push({ ...e, _cal: id }));
    } catch (e) { if (e.code === 'NOT_LOGGED_IN') throw e; }
  }));
  return out;
}));
ipcMain.handle('ev:get', wrap(async (calId, id) => api('GET', `/calendars/${enc1(calId)}/events/${enc1(id)}`)));
// ---------- 일정 도우미: AI(선택) ----------
// 키는 각자 넣는 무료 Gemini 키. 이 컴퓨터에만 암호화해 저장하고, 붙여넣은 글만 구글 AI로 보낸다.
ipcMain.handle('assist:setKey', wrap(async (key) => {
  key = String(key || '').trim();
  if (key) {
    // 저장 전에 진짜 쓸 수 있는 키인지 한 번 확인
    if (!/^AIza[\w-]{20,}$/.test(key)) { const e = new Error('키 모양이 달라요. AIza로 시작하는 키 전체를 복사해 붙여넣어 주세요.'); e.code = 'BAD_KEY'; throw e; }
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } }).catch(() => null);
    if (!r) { const e = new Error('인터넷 연결을 확인해 주세요.'); e.code = 'NET'; throw e; }
    if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(r.status === 400 || r.status === 403 ? '이 키로는 연결되지 않아요. 키를 다시 복사해 붙여넣거나 새 키를 만들어 주세요.' : ('확인 실패: ' + ((j.error && j.error.message) || r.status))); e.code = 'BAD_KEY'; throw e; }
  }
  if (key) cfg.aiKey = enc(key); else delete cfg.aiKey;
  saveCfg();
  [win, settingsWin].forEach(w => { if (w && !w.isDestroyed()) w.webContents.send('app:cfg'); });
  return { hasAiKey: !!key };
}));
ipcMain.handle('assist:ai', wrap(async (text, today) => {
  const key = dec(cfg.aiKey || '');
  if (!key) { const e = new Error('NO_KEY'); e.code = 'NO_KEY'; throw e; }
  const prompt = `오늘은 ${today}이다(한국 시간). 아래 글은 학교 메신저·공문·메일이다. 글을 읽는 사람이 해야 하거나 참석해야 하는 일 중 날짜가 있는 것만 골라 JSON 배열로만 답하라.
각 항목: {"kind":"제출|회의|연수|출장|촬영|발표|일정|할일 중 하나","title":"날짜·시간을 뺀 짧은 제목(25자 이내, 무엇을 하는지)","date":"YYYY-MM-DD","endDate":"YYYY-MM-DD 또는 null","time":"HH:MM(24시간) 또는 null","endTime":"HH:MM 또는 null","location":"장소 또는 빈 문자열"}
규칙: 마감·제출·회신·신청 기한은 kind "제출", date는 마감일, time은 마감 시각. 연도가 없으면 오늘 기준으로 가장 가까운 앞날로. 단순 인사·이미 끝난 일·날짜 없는 것은 빼라. 없으면 [].
글:
"""${String(text).slice(0, 6000)}"""`;
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('AI 응답 오류 ' + r.status)); e.code = r.status === 400 || r.status === 403 ? 'BAD_KEY' : 'AI_ERR'; throw e; }
  const out = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  const arr = JSON.parse((out[0] && out[0].text) || '[]');
  return Array.isArray(arr) ? arr : (arr.items || []);
}));
ipcMain.handle('ev:create', wrap(async (calId, body) => api('POST', `/calendars/${enc1(calId)}/events`, null, body)));
ipcMain.handle('ev:patch', wrap(async (calId, id, body) => api('PATCH', `/calendars/${enc1(calId)}/events/${enc1(id)}`, null, body)));
ipcMain.handle('ev:delete', wrap(async (calId, id) => api('DELETE', `/calendars/${enc1(calId)}/events/${enc1(id)}`)));

ipcMain.handle('win:action', wrap(async (act, arg) => {
  if (!win) return;
  if (act === 'minimize') win.minimize();
  if (act === 'material') { const on = !!arg && ACRYLIC; try { if (win.setBackgroundMaterial) win.setBackgroundMaterial(on ? 'acrylic' : 'none'); } catch {} try { win.setBackgroundColor(on ? '#00000000' : '#f6f7f9'); } catch {} }
  if (act === 'opacity') win.setOpacity(Math.min(1, Math.max(0.3, Number(arg) || 1)));
  if (act === 'mini') {
    const on = !!arg; if (on === !!cfg.mini) return;
    const cur = win.getBounds();
    if (on) {
      cfg.bounds = cur;
      const mb = cfg.miniBounds || { width: 320, height: 460, x: cur.x + cur.width - 320, y: cur.y };
      cfg.mini = true; win.setMinimumSize(240, 200); win.setBounds(mb);
    } else {
      cfg.miniBounds = cur; cfg.mini = false;
      win.setMinimumSize(560, 420); win.setBounds(cfg.bounds || { width: 980, height: 660, x: cur.x + cur.width - 980, y: cur.y });
    }
    saveCfg();
  }
  if (act === 'hide') win.hide();
  if (act === 'open' && typeof arg === 'string' && /^https:\/\//.test(arg)) shell.openExternal(arg);
  if (act === 'quit') { quitting = true; app.quit(); }
  if (act === 'openSettings') openSettingsWindow();
  if (act === 'alarmRefresh') fetchAlarmEvents().catch(() => {});
  if (act === 'alarmTest') testAlarm();
  if (act === 'draft') win.webContents.send('app:settings', { type: 'draft', patch: arg });
  if (act === 'settingsDone') { settingsDone = true; win.webContents.send('app:settings', { type: arg === 'save' ? 'save' : 'cancel' }); if (settingsWin) settingsWin.close(); }
}));

// ---------- 창 ----------
function applyWindowCfg() {
  if (!win) return;
  win.setOpacity(Math.min(1, Math.max(0.3, Number(cfg.opacity) || 1)));
  const glass = (cfg.style || 'glass') === 'glass' && ACRYLIC && cfg.scene === 'desktop';
  try { if (process.platform === 'win32' && win.setBackgroundMaterial) win.setBackgroundMaterial(glass ? 'acrylic' : 'none'); } catch (e) { console.error(e); }
  try { win.setBackgroundColor(glass ? '#00000000' : '#f6f7f9'); } catch {}
  win.setAlwaysOnTop(!!cfg.alwaysOnTop);
  win.setMovable(!cfg.locked);
  win.setResizable(!cfg.locked);
  try { app.setLoginItemSettings({ openAtLogin: !!cfg.autoStart, path: process.execPath }); } catch {}
  if (tray) tray.setContextMenu(trayMenu());
}

// 설정은 달력 밖으로도 옮길 수 있는 별도 창으로 띄운다
function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  const b = win.getBounds(); const wa = screen.getDisplayMatching(b).workArea;
  const w = 660, h = Math.min(720, wa.height - 40);
  let x = b.x - w - 12; if (x < wa.x) x = Math.min(b.x + b.width + 12, wa.x + wa.width - w); if (x < wa.x) x = wa.x + 20;
  settingsDone = false;
  settingsWin = new BrowserWindow({
    width: w, height: h, x, y: Math.max(wa.y, b.y), minWidth: 420, minHeight: 360, title: 'Ram Calendar 설정', icon: iconPath(),
    autoHideMenuBar: true, alwaysOnTop: !!cfg.alwaysOnTop, backgroundColor: '#f6f7f9', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { search: 'settings=1' });
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  settingsWin.on('closed', () => { if (!settingsDone && win) win.webContents.send('app:settings', { type: 'cancel' }); settingsWin = null; });
}

function iconPath() { return path.join(__dirname, 'assets', 'icon.png'); }

function createWindow() {
  const wa = screen.getPrimaryDisplay().workArea;
  let b = cfg.mini ? (cfg.miniBounds || cfg.bounds) : cfg.bounds;
  const visible = b && screen.getAllDisplays().some(d => {
    const a = d.workArea; return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 10 && b.y < a.y + a.height - 40;
  });
  if (!visible) b = { width: 980, height: 660, x: wa.x + wa.width - 1000, y: wa.y + 20 };
  win = new BrowserWindow({
    ...b, minWidth: cfg.mini ? 240 : 560, minHeight: cfg.mini ? 200 : 420, titleBarStyle: 'hidden', show: false, skipTaskbar: false,
    backgroundColor: '#f6f7f9', title: APP_NAME, icon: iconPath(), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { applyWindowCfg(); win.show(); });
  const saveBounds = () => { if (win && !win.isMinimized()) { if (cfg.mini) cfg.miniBounds = win.getBounds(); else cfg.bounds = win.getBounds(); saveCfg(); } };
  win.on('moved', saveBounds); win.on('resized', saveBounds);
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('focus', () => win.webContents.send('app:focus'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Ram Calendar 열기', click: () => { win.show(); win.focus(); } },
    { label: '새로고침', click: () => win.webContents.send('app:refresh') },
    { label: '업데이트 확인 (현재 v' + app.getVersion() + ')', click: () => checkUpdate(true) },
    { type: 'separator' },
    { label: '항상 위에 표시', type: 'checkbox', checked: !!cfg.alwaysOnTop, click: (m) => { cfg.alwaysOnTop = m.checked; saveCfg(); applyWindowCfg(); win.webContents.send('app:cfg'); } },
    { label: '위치·크기 고정', type: 'checkbox', checked: !!cfg.locked, click: (m) => { cfg.locked = m.checked; saveCfg(); applyWindowCfg(); win.webContents.send('app:cfg'); } },
    { label: '윈도우 시작 시 실행', type: 'checkbox', checked: !!cfg.autoStart, click: (m) => { cfg.autoStart = m.checked; saveCfg(); applyWindowCfg(); win.webContents.send('app:cfg'); } },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } }
  ]);
}

// ---------- 자동 업데이트 (깃허브 릴리스) ----------
let updater = null;
let updateReady = null; // 받아 둔 새 버전
function askRestart() {
  const { dialog } = require('electron');
  dialog.showMessageBox(win && !win.isDestroyed() ? win : null, { type: 'info', title: APP_NAME, message: 'v' + updateReady + ' 업데이트를 받아 두었어요.', detail: '지금 다시 켜면 바로 적용돼요.', buttons: ['지금 다시 켜기', '나중에'], defaultId: 0, cancelId: 1 })
    .then(r => { if (r.response === 0) { quitting = true; updater.quitAndInstall(false, true); } });
}
function updateMsg(text) {
  const { dialog } = require('electron');
  dialog.showMessageBox(win && !win.isDestroyed() ? win : null, { type: 'info', title: APP_NAME, message: text, buttons: ['확인'] });
}
function checkUpdate(manual) {
  if (!app.isPackaged) { if (manual) updateMsg('개발용 실행에서는 업데이트를 확인하지 않아요.'); return; }
  try {
    if (!updater) {
      updater = require('electron-updater').autoUpdater;
      updater.autoDownload = true; updater.autoInstallOnAppQuit = true;
      updater.on('update-downloaded', (info) => {
        updateReady = info.version;
        if (win) win.webContents.send('app:update', 'v' + info.version + ' 업데이트를 받았어요. 앱을 다시 켜면 적용돼요.');
        if (updater._manual) askRestart();
      });
      updater.on('update-available', (info) => { if (updater._manual && win) win.webContents.send('app:update', 'v' + info.version + ' 새 버전을 받는 중이에요…'); });
      updater.on('update-not-available', () => { if (updater._manual) updateMsg('최신 버전이에요 (v' + app.getVersion() + ').'); });
      updater.on('error', (e) => { if (updater._manual) updateMsg('업데이트를 확인하지 못했어요. 인터넷 연결을 확인해 주세요.\n(' + (e && e.message || e) + ')'); });
    }
    updater._manual = !!manual;
    if (manual && updateReady) return askRestart();
    updater.checkForUpdates().catch(() => {});
  } catch (e) { console.error(e); }
}

// 작업 표시줄 아이콘을 오른쪽 클릭했을 때 나오는 메뉴(점프 목록)
function setJumpList() {
  if (process.platform !== 'win32') return;
  const t = (arg, title, description, icon) => ({ program: process.execPath, arguments: arg, iconPath: process.execPath, iconIndex: 0, title, description });
  try {
    app.setUserTasks([
      t('--check-update', '업데이트 확인', '새 버전이 있는지 확인해요'),
      t('--open-settings', '설정 열기', 'Ram Calendar 설정을 열어요'),
      t('--quit', '완전히 종료', '트레이까지 Ram Calendar를 꺼요')
    ]);
  } catch (e) { console.error(e); }
}
function handleArgs(argv) {
  if (argv.includes('--check-update')) checkUpdate(true);
  else if (argv.includes('--open-settings')) openSettingsWindow();
  else if (argv.includes('--quit')) { quitting = true; app.quit(); }
  else if (win) { win.show(); win.focus(); }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => handleArgs(argv || []));
  app.whenReady().then(() => {
    app.setAppUserModelId('kr.yeram.calendar');
    if (process.argv.includes('--quit')) { app.quit(); return; }
    loadCfg();
    // 설정의 글꼴 목록에 내 PC에 설치된 글꼴을 보여주기 위해 허용
    session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'local-fonts');
    session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'local-fonts'));
    createWindow();
    startAlarms();
    setJumpList();
    // 앱이 꺼져 있을 때 점프 목록으로 켠 경우
    setTimeout(() => { if (process.argv.includes('--check-update')) checkUpdate(true); else if (process.argv.includes('--open-settings')) openSettingsWindow(); }, 1500);
    try {
      tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
      tray.setToolTip(APP_NAME);
      tray.setContextMenu(trayMenu());
      setTimeout(() => checkUpdate(false), 8000);
      setInterval(() => checkUpdate(false), 6 * 60 * 60 * 1000);
      tray.on('click', () => { if (win.isVisible() && win.isFocused()) win.hide(); else { win.show(); win.focus(); } });
    } catch (e) { console.error(e); }
  });
  app.on('before-quit', (e) => {
    quitting = true;
    // 아직 못 올린 메모가 있으면 올리고 끄기(최대 4초)
    if (pushTimer) { e.preventDefault(); clearTimeout(pushTimer); pushTimer = null; Promise.race([pushSync(), new Promise(r => setTimeout(r, 4000))]).catch(() => {}).finally(() => app.quit()); }
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
