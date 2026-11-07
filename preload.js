const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  getCfg: call('cfg:get'),
  setCfg: call('cfg:set'),
  login: call('auth:login'),
  logout: call('auth:logout'),
  calendars: call('cal:list'),
  events: call('ev:list'),
  search: call('ev:search'),
  getEvent: call('ev:get'),
  create: call('ev:create'),
  patch: call('ev:patch'),
  remove: call('ev:delete'),
  win: call('win:action'),
  syncPull: call('sync:pull'),
  alarmAct: call('alarm:act'),
  muteGoogleDefaults: call('gcal:muteDefaults'),
  assistAI: call('assist:ai'),
  assistKey: call('assist:setKey'),
  on: (ch, fn) => {
    if (!['app:focus', 'app:refresh', 'app:cfg', 'app:update', 'app:settings', 'app:goto'].includes(ch)) return;
    ipcRenderer.on(ch, (_e, arg) => fn(arg));
  }
});
