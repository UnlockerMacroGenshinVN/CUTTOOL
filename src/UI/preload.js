const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unlockerNative', {
    getConfig: () => ipcRenderer.invoke('get-unlocker-config'),
    saveConfig: (data) => ipcRenderer.invoke('save-unlocker-config', data),
    launchGame: (gamePath) => ipcRenderer.invoke('launch-game', gamePath),
    selectGamePath: () => ipcRenderer.invoke('select-game-path'),
    selectBannerImage: () => ipcRenderer.invoke('select-banner-image')
});
