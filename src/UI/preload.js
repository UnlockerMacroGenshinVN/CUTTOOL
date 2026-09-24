const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unlockerNative', {
    getConfig: () => ipcRenderer.invoke('get-unlocker-config'),
    saveConfig: (data) => ipcRenderer.invoke('save-unlocker-config', data),
    launchGame: (gamePath) => ipcRenderer.invoke('launch-game', gamePath),
    selectGamePath: () => ipcRenderer.invoke('select-game-path'),
    selectBannerImage: () => ipcRenderer.invoke('select-banner-image'),
    // Update Checker & Auto-Updater APIs
    checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
    startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
    cancelUpdateDownload: () => ipcRenderer.invoke('cancel-update-download'),
    applyUpdateAndRestart: () => ipcRenderer.invoke('apply-update-and-restart'),
    getUpdateState: () => ipcRenderer.invoke('get-update-state'),
    onUpdateProgress: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('update-progress', handler);
        return () => ipcRenderer.removeListener('update-progress', handler);
    },
    onUpdateStatus: (cb) => {
        const handler = (_event, data) => cb(data);
        ipcRenderer.on('update-status', handler);
        return () => ipcRenderer.removeListener('update-status', handler);
    }
});
