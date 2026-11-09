const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mcc', {
  getState: () => ipcRenderer.invoke('state:get'),
  addAccount: (a) => ipcRenderer.invoke('accounts:add', a),
  updateAccount: (a) => ipcRenderer.invoke('accounts:update', a),
  removeAccount: (id, clearData) => ipcRenderer.invoke('accounts:remove', { id, clearData }),
  reorder: (ids) => ipcRenderer.invoke('accounts:reorder', ids),
  setGridZoom: (z) => ipcRenderer.invoke('settings:gridZoom', z),
  layout: (l) => ipcRenderer.send('layout', l),
  modal: (open) => ipcRenderer.send('modal', open),
  action: (id, action) => ipcRenderer.send('view:action', { id, action }),
  installUpdate: () => ipcRenderer.send('update:install'),
  on: (channel, fn) => {
    const ok = ['account:update', 'account:focused', 'nav', 'update:ready'];
    if (ok.includes(channel)) ipcRenderer.on(channel, (_e, p) => fn(p));
  },
});
