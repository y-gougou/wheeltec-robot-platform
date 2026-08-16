const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  onMaximizeChange: (callback) => {
    ipcRenderer.on('window-maximize-change', (_event, isMaximized) => {
      callback(isMaximized);
    });
  },

  removeMaximizeListener: () => {
    ipcRenderer.removeAllListeners('window-maximize-change');
  },

  openExternal: (url) => ipcRenderer.send('open-external', url),

  db: {
    getSettings: () => ipcRenderer.invoke('db:get-settings'),
    setSetting: (key, value) => ipcRenderer.invoke('db:set-setting', key, value),
    getSetting: (key, fallback) => ipcRenderer.invoke('db:get-setting', key, fallback),
    getSchemaVersion: () => ipcRenderer.invoke('db:get-schema-version'),
    listSchemaMigrations: () => ipcRenderer.invoke('db:list-schema-migrations'),
    recordConnection: (ip, status) => ipcRenderer.invoke('db:record-connection', ip, status),
    listConnections: (limit) => ipcRenderer.invoke('db:list-connections', limit),
    addSyncEvent: (eventType, robotIp, detail) => ipcRenderer.invoke('db:add-sync-event', eventType, robotIp, detail),
    startDatasetBuild: (payload) => ipcRenderer.invoke('db:start-dataset-build', payload),
    updateDatasetBuild: (id, fields) => ipcRenderer.invoke('db:update-dataset-build', id, fields),
    finishDatasetBuild: (id, payload) => ipcRenderer.invoke('db:finish-dataset-build', id, payload),
    listDatasetBuilds: (limit) => ipcRenderer.invoke('db:list-dataset-builds', limit),
    startExperiment: (payload) => ipcRenderer.invoke('db:start-experiment', payload),
    updateExperiment: (id, fields) => ipcRenderer.invoke('db:update-experiment', id, fields),
    finishExperiment: (id, payload) => ipcRenderer.invoke('db:finish-experiment', id, payload),
    addExperimentEvent: (experimentId, eventType, detail) => ipcRenderer.invoke('db:add-experiment-event', experimentId, eventType, detail),
    listExperiments: (limit) => ipcRenderer.invoke('db:list-experiments', limit),
  },

  inference: {
    getStatus: () => ipcRenderer.invoke('inference:get-status'),
    loadModel: (manifestPath) => ipcRenderer.invoke('inference:load-model', manifestPath),
    reloadModel: (manifestPath) => ipcRenderer.invoke('inference:reload-model', manifestPath),
    predictWindow: (windowRows) => ipcRenderer.invoke('inference:predict-window', windowRows),
    listBackends: () => ipcRenderer.invoke('inference:list-backends'),
    backendStatus: () => ipcRenderer.invoke('inference:backend-status'),
  },

  converter: {
    getStatus: () => ipcRenderer.invoke('converter:get-status'),
    convertSageCnn: (payload) => ipcRenderer.invoke('converter:convert-sage-cnn', payload),
  },
});
