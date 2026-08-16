const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const db = require('./db/database');
const { InferenceService } = require('./inference-service');
const { ModelConverterService } = require('./model-converter-service');

let mainWindow = null;
const appIcon = path.join(__dirname, 'assets', 'icon.png');
let inferenceService = null;
let modelConverterService = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#181818',
    icon: appIcon,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The renderer is a local dashboard; prevent it from navigating the main
  // window or creating arbitrary child windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window-maximize-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window-maximize-change', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function wrap(fn) {
  return async (...args) => {
    try { return await fn(...args); }
    catch (e) { return { error: e.message }; }
  };
}

function setupDatabaseIpc() {
  db.openDatabase(app.getPath('userData'));

  ipcMain.handle('db:get-settings', wrap(() => db.getSettings()));
  ipcMain.handle('db:set-setting', wrap((_event, key, value) => db.setSetting(key, value)));
  ipcMain.handle('db:get-setting', wrap((_event, key, fallback) => db.getSetting(key, fallback)));
  ipcMain.handle('db:get-schema-version', wrap(() => db.getSchemaVersion()));
  ipcMain.handle('db:list-schema-migrations', wrap(() => db.listSchemaMigrations()));
  ipcMain.handle('db:record-connection', wrap((_event, ip, status) => db.recordConnection(ip, status)));
  ipcMain.handle('db:list-connections', wrap((_event, limit) => db.listConnections(limit)));
  ipcMain.handle('db:add-sync-event', wrap((_event, eventType, robotIp, detail) => db.addSyncEvent(eventType, robotIp, detail)));
  ipcMain.handle('db:start-dataset-build', wrap((_event, payload) => db.startDatasetBuild(payload)));
  ipcMain.handle('db:update-dataset-build', wrap((_event, id, fields) => db.updateDatasetBuild(id, fields)));
  ipcMain.handle('db:finish-dataset-build', wrap((_event, id, payload) => db.finishDatasetBuild(id, payload)));
  ipcMain.handle('db:list-dataset-builds', wrap((_event, limit) => db.listDatasetBuilds(limit)));
  ipcMain.handle('db:start-experiment', wrap((_event, payload) => db.startExperiment(payload)));
  ipcMain.handle('db:update-experiment', wrap((_event, id, fields) => db.updateExperiment(id, fields)));
  ipcMain.handle('db:finish-experiment', wrap((_event, id, payload) => db.finishExperiment(id, payload)));
  ipcMain.handle('db:add-experiment-event', wrap((_event, experimentId, eventType, detail) => db.addExperimentEvent(experimentId, eventType, detail)));
  ipcMain.handle('db:list-experiments', wrap((_event, limit) => db.listExperiments(limit)));
}

function setupInferenceIpc() {
  inferenceService = new InferenceService(app);
  modelConverterService = new ModelConverterService(app);

  ipcMain.handle('inference:get-status', wrap(() => inferenceService.getStatus()));
  ipcMain.handle('inference:load-model', wrap((_event, manifestPath) => inferenceService.loadModel(manifestPath)));
  ipcMain.handle('inference:reload-model', wrap((_event, manifestPath) => inferenceService.loadModel(manifestPath)));
  ipcMain.handle('inference:predict-window', wrap((_event, windowRows) => inferenceService.predictWindow(windowRows)));
  ipcMain.handle('inference:list-backends', wrap(() => inferenceService.listBackends()));
  ipcMain.handle('inference:backend-status', wrap(() => inferenceService.backendStatus()));
  ipcMain.handle('converter:get-status', wrap(() => modelConverterService.getStatus()));
  ipcMain.handle('converter:convert-sage-cnn', wrap((_event, payload) => modelConverterService.convertSageCnn(payload)));
}

// Window control IPC
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// Open external links in browser (validate protocol)
ipcMain.on('open-external', (_, url) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      shell.openExternal(url);
    }
  } catch {}
});

app.whenReady().then(() => {
  setupDatabaseIpc();
  setupInferenceIpc();
  createWindow();
});

app.on('window-all-closed', () => {
  if (inferenceService) inferenceService.shutdown();
  db.closeDatabase();
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
