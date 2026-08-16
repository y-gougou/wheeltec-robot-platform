/* ═══════════════════════════════════════════════════════
   WHEELTEC Console — Application Logic
   RosClient · State · Views · Charts · Drive · Collect
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var modules = window.WheelTecModules || {};
  var TOPICS = modules.TOPICS || {};
  var RosClient = modules.RosClient;
  var TimeSeriesChart = modules.TimeSeriesChart;
  var Drive = modules.Drive || {};
  var Collection = modules.Collection || {};
  var Experiment = modules.Experiment || {};
  var DataWorkspace = modules.DataWorkspace || {};
  var emptyTwist = Drive.emptyTwist || function () {
    return { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
  };

  // ── i18n ──────────────────────────────────────────
  var dict = window.I18N || { zh: {}, en: {} };

  function t(key) {
    return dict[state.lang]?.[key] || dict.en?.[key] || key;
  }

  function i18nAll() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.dataset.i18n;
      if (!k) return;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
      el.textContent = t(k);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('select option[data-i18n]').forEach(function (opt) {
      opt.textContent = t(opt.dataset.i18n);
    });
  }

  // ── State ─────────────────────────────────────────
  var state = {
    activeActivity: 'dashboard',
    theme: loadStored('theme', 'dark'),
    lang: loadStored('lang', 'zh'),
    appearance: {
      fontFamily: loadStored('appearanceFontFamily', 'system'),
      fontSize: Number(loadStored('appearanceFontSize', '13')) || 13,
      bgImage: loadStored('appearanceBgImage', ''),
      bgOpacity: Number(loadStored('appearanceBgOpacity', '0')) || 0,
      bgBlur: Number(loadStored('appearanceBgBlur', '0')) || 0,
    },
    connection: {
      ip: loadStored('lastIp', ''),
      imuTopic: loadStored('imuTopic', '/n100/imu'),
      status: 'offline',
    },
    rosClient: null,
    charts: {},
    connectionStartTime: null,
    msgCount: 0,
    msgRate: 0,
    eventLog: [],
    connectionHistory: JSON.parse(loadStored('connectionHistory', '[]')),
    // ── Drive state ──
    drive: {
      stick: { x: 0, y: 0 },
      lateral: 0,
      mult: 1,
      estopActive: false,
      controlStatus: '',
      driveActive: false,
    },
    // ── Cruise state ──
    cruise: {
      speed: 0.2,
      direction: { x: 1, y: 0 },
      active: false,
      status: '',
    },
    // ── Heading state ──
    heading: {
      targetAngle: 0,
      angleState: 'idle',
      status: {},
    },
    // ── Collection state ──
    collection: {
      runId: '',
      outputDir: '/home/wheeltec/R550PLUS_data_collect/log_v2',
      currentPort: '/dev/ttyUSB1',
      faultLabel: 0,
      faultMode: 0,
      motionMode: 'straight_back_forth_0.25ms',
      expectedRate: 20,
      autoStopDuration: 0,
      status: { state: 'idle', collecting: false, sample_id: 0 },
      current: { connected: false, port: '/dev/ttyUSB1', valid_total: 0 },
      files: [],
      fileError: '',
      showAdvanced: true,
      autoStopTimer: null,
      lastActivePreviewAt: 0,
      lastCollectionErrorLogged: '',
    },
    // ── Fault injection state ──
    faultInjection: {
      enableFault: false,
      faultType: 'normal',
      wheels: { A: false, B: false, C: false },
      alpha: { A: 1, B: 1, C: 1 },
      status: {},
    },
    // ── Experiment state ──
    experiment: {
      faultType: 'normal',
      wheels: { A: false, B: true, C: false },
      alpha: { A: 1, B: 0.5, C: 1 },
      runId: '',
      motionMode: 'straight_back_forth_0.25ms',
      durationSec: 60,
      expectedRate: 20,
      outputDir: '/home/wheeltec/R550PLUS_data_collect/log_v2',
      running: false,
      autoStopTimer: null,
      localId: null,
      pendingRecord: null,
      recent: [],
      lastRowsSyncedCount: 0,
      lastRowsSyncAt: 0,
    },
    // ── CSV preview ──
    csvPreview: {
      selectedFile: '',
      preview: null,
      previewLoading: false,
      previewError: '',
      rowLimit: 100,
      columnFilter: '',
    },
    // ── Data summary ──
    dataSummary: null,
    dataset: {
      inputDir: '/home/wheeltec/R550PLUS_data_collect/log_v2',
      outputDir: '/home/wheeltec/R550PLUS_dataset/four_class_v1',
      featureSet: '15ch',
      windowSize: 50,
      stepSize: 10,
      scaler: 'standard',
      trimStart: 5,
      trimEnd: 5,
      allowSameRunSplit: false,
      building: false,
      buildId: '',
      buildLog: [],
      buildResult: null,
      buildError: '',
      datasets: [],
      pollTimer: null,
      localBuildId: null,
      recentBuilds: [],
    },
    inference: {
      manifestPath: loadStored('inferenceManifestPath', ''),
      windowSize: 50,
      stepSize: 10,
      rows: [],
      samplesSincePredict: 0,
      pending: false,
      loaded: false,
      lastResult: null,
      lastError: '',
      statusText: '',
      backend: '--',
      device: '--',
      missingReason: '',
    },
    faultAlarm: {
      enabled: loadStored('faultAlarmEnabled', 'false') === 'true',
      latched: false,
      consecutive: 0,
      candidateFirstAt: '',
      faultClass: '',
      confidence: null,
      firstAt: '',
      lastAt: '',
      detail: null,
      threshold: 3,
    },
    modelConverter: {
      modelRoot: loadStored('modelConverterModelRoot', ''),
      selectedDir: loadStored('modelConverterSelectedDir', ''),
      outputDir: loadStored('modelConverterOutputDir', ''),
      pythonPath: loadStored('modelConverterPythonPath', ''),
      running: false,
      log: '',
      lastError: '',
    },
    // ── Gamepad ──
    gamepad: {
      connected: false,
      gamepadIndex: -1,
    },
    // ── Keyboard state ──
    keys: {},
  };

  function loadStored(key, fallback) {
    try { var v = localStorage.getItem(key); return v !== null ? v : fallback; }
    catch (_) { return fallback; }
  }
  function saveStored(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function dbApi() {
    return window.electronAPI && window.electronAPI.db ? window.electronAPI.db : null;
  }

  function dbSetSetting(key, value) {
    var db = dbApi();
    if (!db) return;
    db.setSetting(key, value).catch(function (e) { console.warn('DB error:', e.message); });
  }

  function dbRecordConnection(ip, status) {
    var db = dbApi();
    if (!db || !ip) return;
    db.recordConnection(ip, status).catch(function (e) { console.warn('DB error:', e.message); });
  }

  function dbAddSyncEvent(eventType, detail) {
    var db = dbApi();
    if (!db || !db.addSyncEvent) return;
    db.addSyncEvent(eventType, state.connection.ip || null, detail || {}).catch(function (e) { console.warn('DB error:', e.message); });
  }

  function dbStartExperimentRecord(payload) {
    var db = dbApi();
    if (!db) return;
    state.experiment.pendingRecord = db.startExperiment(payload).then(function (row) {
      state.experiment.localId = row && row.id ? row.id : null;
      refreshExperimentHistory();
      return row;
    }).catch(function (e) { console.warn('DB error:', e.message); }).finally(function () {
      state.experiment.pendingRecord = null;
    });
  }

  function dbAddExperimentEvent(eventType, detail) {
    var db = dbApi();
    if (!db) return;
    function write(id) {
      db.addExperimentEvent(id || null, eventType, detail).catch(function (e) { console.warn('DB error:', e.message); });
    }
    if (state.experiment.localId) write(state.experiment.localId);
    else if (state.experiment.pendingRecord) {
      state.experiment.pendingRecord.then(function (row) { write(row && row.id); });
    } else {
      write(null);
    }
  }

  function dbUpdateExperiment(fields) {
    var db = dbApi();
    if (!db) return;
    function write(id) {
      if (!id) return;
      db.updateExperiment(id, fields).then(refreshExperimentHistory).catch(function (e) { console.warn('DB error:', e.message); });
    }
    if (state.experiment.localId) write(state.experiment.localId);
    else if (state.experiment.pendingRecord) {
      state.experiment.pendingRecord.then(function (row) { write(row && row.id); });
    }
  }

  function dbFinishExperimentRecord(payload) {
    var db = dbApi();
    if (!db) return;
    function write(id) {
      if (!id) return;
      db.finishExperiment(id, payload).then(function () {
        state.experiment.localId = null;
        refreshExperimentHistory();
      }).catch(function (e) { console.warn('DB error:', e.message); });
    }
    if (state.experiment.localId) write(state.experiment.localId);
    else if (state.experiment.pendingRecord) {
      state.experiment.pendingRecord.then(function (row) { write(row && row.id); });
    }
  }

  function refreshExperimentHistory() {
    var db = dbApi();
    if (!db || !dom.expHistoryBody) return;
    db.listExperiments(12).then(function (rows) {
      state.experiment.recent = rows || [];
      renderExperimentHistory();
    }).catch(function (e) { console.warn('DB error:', e.message); });
  }

  function refreshDatasetBuildHistory() {
    if (dataWorkspace) dataWorkspace.refreshDatasetBuildHistory();
  }

  // ── DOM refs ──────────────────────────────────────
  var $ = function (id) { return document.getElementById(id); };

  var dom = {
    // Title bar
    btnTheme: $('btn-theme'),
    btnLang: $('btn-lang'),
    btnMinimize: $('btn-minimize'),
    btnMaximize: $('btn-maximize'),
    btnClose: $('btn-close'),
    // Sidebar - connection
    inputIp: $('input-ip'),
    selectImu: $('select-imu'),
    btnConnect: $('btn-connect'),
    btnDisconnect: $('btn-disconnect'),
    statusDetailState: $('status-detail-text'),
    statusDetailUrl: $('status-detail-url'),
    statusDetailRate: $('status-detail-rate'),
    statusDetailUptime: $('status-detail-uptime'),
    sidebarConnection: $('sidebar-connection'),
    sidebarStatus: $('sidebar-status'),
    sidebarCharts: $('sidebar-charts'),
    sidebarSettings: $('sidebar-settings'),
    sidebarDrive: $('sidebar-drive'),
    sidebarCollect: $('sidebar-collect'),
    sidebarExperiment: $('sidebar-experiment'),
    selectTheme: $('select-theme'),
    selectLang: $('select-lang'),
    selectFontFamily: $('select-font-family'),
    inputFontSize: $('input-font-size'),
    fontSizeValue: $('font-size-value'),
    inputBgImage: $('input-bg-image'),
    inputBgOpacity: $('input-bg-opacity'),
    bgOpacityValue: $('bg-opacity-value'),
    inputBgBlur: $('input-bg-blur'),
    bgBlurValue: $('bg-blur-value'),
    btnAppearanceReset: $('btn-appearance-reset'),
    inputInferenceManifest: $('input-inference-manifest'),
    inputModelRoot: $('input-model-root'),
    inputSelectedModelDir: $('input-selected-model-dir'),
    inputModelOutputDir: $('input-model-output-dir'),
    inputPythonRuntime: $('input-python-runtime'),
    btnInferenceReload: $('btn-inference-reload'),
    btnModelConvert: $('btn-model-convert'),
    btnInferenceStatus: $('btn-inference-status'),
    modelConvertLog: $('model-convert-log'),
    inferenceSettingsStatus: $('inference-settings-status'),
    inferClass: $('infer-class'),
    inferConfidence: $('infer-confidence'),
    inferBackend: $('infer-backend'),
    inferDevice: $('infer-device'),
    inferLatency: $('infer-latency'),
    inferWindow: $('infer-window'),
    inferProbs: $('infer-probs'),
    inferError: $('infer-error'),
    connectionHistory: $('connection-history'),
    // Activity bar
    activitybar: $('activitybar'),
    activityBtns: document.querySelectorAll('.activity-btn'),
    // Views
    viewDashboard: $('view-dashboard'),
    viewDrive: $('view-drive'),
    viewCharts: $('view-charts'),
    viewCollect: $('view-collect'),
    viewExperiment: $('view-experiment'),
    viewSettings: $('view-settings'),
    // Status bar
    statusUrl: $('status-url-text'),
    statusState: $('status-state-text'),
    statusRate: $('status-rate-text'),
    statusGamepad: $('status-gamepad-text'),
    statusbarFaultEnableBtn: $('statusbar-fault-enable-btn'),
    statusbarFaultResetBtn: $('statusbar-fault-reset-btn'),
    // Event log
    eventLog: $('event-log'),
    // Drive
    dpadCanvas: $('dpad-canvas'),
    inputStrafe: $('input-strafe'),
    selectSpeedMult: $('select-speed-mult'),
    btnStop: $('btn-stop'),
    btnEstop: $('btn-estop'),
    estopIndicator: $('estop-indicator'),
    inputCruiseSpeed: $('input-cruise-speed'),
    cruiseDirGrid: $('cruise-dir-grid'),
    btnCruiseStart: $('btn-cruise-start'),
    btnCruiseStop: $('btn-cruise-stop'),
    cruiseStatusText: $('cruise-status-text'),
    inputHeadingAngle: $('input-heading-angle'),
    btnHeadingSend: $('btn-heading-send'),
    btnHeadingZero: $('btn-heading-zero'),
    headingStateText: $('heading-state-text'),
    // Collect
    collectStateText: $('collect-state-text'),
    collectRowsText: $('collect-rows-text'),
    inputCollectRunid: $('input-collect-runid'),
    inputCollectOutput: $('input-collect-output'),
    inputCurrentPort: $('input-current-port'),
    btnCollectStart: $('btn-collect-start'),
    btnCollectStop: $('btn-collect-stop'),
    currentPortText: $('current-port-text'),
    currentFramesText: $('current-frames-text'),
    btnCurrentReconnect: $('btn-current-reconnect'),
    advancedToggle: $('advanced-toggle'),
    advancedPanel: $('advanced-panel'),
    inputCollectFaultLabel: $('input-collect-fault-label'),
    inputCollectFaultMode: $('input-collect-fault-mode'),
    inputCollectMotion: $('input-collect-motion'),
    inputCollectRate: $('input-collect-rate'),
    inputCollectAutostop: $('input-collect-autostop'),
    qualityRateText: $('quality-rate-text'),
    qualityDriftText: $('quality-drift-text'),
    qualityAgeText: $('quality-age-text'),
    qualityDurationText: $('quality-duration-text'),
    csvTableBody: $('csv-table-body'),
    csvHttpDebug: $('csv-http-debug'),
    csvHttpLog: $('csv-http-log'),
    csvPreviewHead: $('csv-preview-head'),
    csvPreviewBody: $('csv-preview-body'),
    csvPreviewWrap: document.querySelector('.csv-preview-table-wrap'),
    csvPreviewInfo: $('csv-preview-info'),
    selectCsvPreviewRows: $('select-csv-preview-rows'),
    inputCsvColumnFilter: $('input-csv-column-filter'),
    btnCsvRefresh: $('btn-csv-refresh'),
    summaryFiles: $('summary-files'),
    summarySelected: $('summary-selected'),
    summaryRows: $('summary-rows'),
    summaryTime: $('summary-time'),
    btnSummaryRefresh: $('btn-summary-refresh'),
    inputDatasetInput: $('input-dataset-input'),
    inputDatasetOutput: $('input-dataset-output'),
    selectDatasetFeature: $('select-dataset-feature'),
    inputDatasetWindow: $('input-dataset-window'),
    inputDatasetStep: $('input-dataset-step'),
    selectDatasetScaler: $('select-dataset-scaler'),
    inputDatasetTrimStart: $('input-dataset-trim-start'),
    inputDatasetTrimEnd: $('input-dataset-trim-end'),
    inputDatasetSameRun: $('input-dataset-same-run'),
    btnDatasetBuild: $('btn-dataset-build'),
    btnDatasetRefresh: $('btn-dataset-refresh'),
    datasetStatusText: $('dataset-status-text'),
    datasetLog: $('dataset-log'),
    datasetResult: $('dataset-result'),
    datasetList: $('dataset-list'),
    datasetBuildHistoryBody: $('dataset-build-history-body'),
    // Experiment
    inputExperimentFaultType: $('input-experiment-fault-type'),
    expWheelA: $('exp-wheel-a'),
    expWheelB: $('exp-wheel-b'),
    expWheelC: $('exp-wheel-c'),
    expAlphaA: $('exp-alpha-a-value'),
    expAlphaB: $('exp-alpha-b-value'),
    expAlphaC: $('exp-alpha-c-value'),
    inputExperimentRunid: $('input-experiment-runid'),
    inputExperimentDuration: $('input-experiment-duration'),
    inputExperimentMotion: $('input-experiment-motion'),
    inputExperimentRate: $('input-experiment-rate'),
    inputExperimentOutput: $('input-experiment-output'),
    btnExperimentStart: $('btn-experiment-start'),
    btnExperimentReset: $('btn-experiment-reset'),
    experimentStatusText: $('experiment-status-text'),
    inputFaultEnable: $('input-fault-enable'),
    btnFaultApply: $('btn-fault-apply'),
    btnFaultReset: $('btn-fault-reset'),
    faultStatusText: $('fault-status-text'),
    expSummaryType: $('exp-summary-type'),
    expSummaryWheels: $('exp-summary-wheels'),
    expSummaryRunid: $('exp-summary-runid'),
    expSummaryDuration: $('exp-summary-duration'),
    expStatusCollect: $('exp-status-collect'),
    expStatusFault: $('exp-status-fault'),
    expStatusRows: $('exp-status-rows'),
    expCsvTableBody: $('exp-csv-table-body'),
    expHistoryBody: $('exp-history-body'),
    // Drive view
    driveValVx: $('drive-val-vx'),
    driveValVy: $('drive-val-vy'),
    driveValWz: $('drive-val-wz'),
    driveValVoltage: $('drive-val-voltage'),
    driveValHeading: $('drive-val-heading'),
    driveValControl: $('drive-val-control'),
    driveValMult: $('drive-val-mult'),
    driveValCruise: $('drive-val-cruise'),
  };

  dataWorkspace = DataWorkspace.create({
    state: state,
    dom: dom,
    apiGet: apiGet,
    apiUrl: apiUrl,
    dbApi: dbApi,
    addLog: addLog,
    t: t,
    escHtml: escHtml,
  });

  // ── Event Log ─────────────────────────────────────
  function addLog(text, cls) {
    state.eventLog.unshift({ text: text, cls: cls || '', time: new Date().toLocaleTimeString() });
    if (state.eventLog.length > 50) state.eventLog.length = 50;
    renderEventLog();
  }

  function renderEventLog() {
    if (!dom.eventLog) return;
    if (state.eventLog.length === 0) {
      dom.eventLog.innerHTML = '<div class="event-entry placeholder">' + t('noData') + '</div>';
      return;
    }
    dom.eventLog.innerHTML = state.eventLog.map(function (e) {
      return '<div class="event-entry ' + e.cls + '"><span class="event-time">' + e.time + '</span>' + escHtml(e.text) + '</div>';
    }).join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── HTTP API Client ──────────────────────────────
  function apiUrl(path, params) {
    if (!state.connection.ip) return '';
    var qs = '';
    if (params) {
      qs = '?' + Object.keys(params).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
    }
    return 'http://' + state.connection.ip + ':8000' + path + qs;
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    options = Object.assign({}, options || {});
    if (typeof AbortController === 'undefined') return fetch(url, options);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 10000);
    options.signal = controller.signal;
    return fetch(url, options).finally(function () {
      clearTimeout(timer);
    });
  }

  function apiGet(path, params, callback) {
    var url = apiUrl(path, params);
    if (!url) { callback('Not connected', null); return; }
    fetchWithTimeout(url, { method: 'GET' }, 10000)
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (text) {
            var detail = text;
            try {
              var parsed = JSON.parse(text);
              detail = parsed.error || parsed.message || text;
            } catch (_) {}
            throw new Error(detail || ('HTTP ' + r.status));
          });
        }
        return r.json();
      })
      .then(function (data) { callback(null, data); })
      .catch(function (err) { callback(err.message, null); });
  }

  // ── Heartbeat ─────────────────────────────────────
  var heartbeatInterval = null;

  function startHeartbeat() {
    if (heartbeatInterval) return;
    heartbeatInterval = setInterval(function () {
      if (state.rosClient && state.connection.status === 'online') {
        state.rosClient.publish(TOPICS.HEARTBEAT, {});
      }
    }, 1000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  // ── Drive Command Loop (40Hz) ─────────────────────
  var driveInterval = null;

  function startDriveLoop() {
    if (driveInterval) return;
    driveInterval = setInterval(function () {
      if (!state.drive.driveActive) return;
      if (!state.rosClient || state.connection.status !== 'online') return;
      publishDriveCommand();
    }, 25);
  }

  function stopDriveLoop() {
    if (driveInterval) {
      clearInterval(driveInterval);
      driveInterval = null;
    }
    // Send zero velocity on stop
    if (state.rosClient && state.connection.status === 'online') {
      state.rosClient.publish(TOPICS.CMD_VEL_WEB, emptyTwist());
    }
  }

  function publishDriveCommand() {
    if (state.drive.estopActive) return;
    var d = state.drive;
    var vx = d.stick.y * d.mult;
    var vy = d.lateral * d.mult;
    var wz = d.stick.x * d.mult;

    // Deadband
    if (Math.abs(vx) < 0.01) vx = 0;
    if (Math.abs(vy) < 0.01) vy = 0;
    if (Math.abs(wz) < 0.01) wz = 0;

    state.rosClient.publish(TOPICS.CMD_VEL_WEB, {
      linear: { x: vx, y: vy, z: 0 },
      angular: { x: 0, y: 0, z: wz },
    });
  }

  // ── Telemetry display ─────────────────────────────
  var telemetry = {
    vx: null, vy: null, wz: null,
    posx: null, posy: null, yaw: null,
    gx: null, gy: null, gz: null,
    ax: null, ay: null, az: null,
    voltage: null,
    c0: null, c1: null, c2: null,
    wa: null, wb: null, wc: null,
    heading: null,
  };
  var dataWorkspace = null;

  function formatVal(v, unit, decimals) {
    if (v == null || !isFinite(v)) return t('noData');
    return v.toFixed(decimals || 2) + ' ' + (unit || '');
  }

  function updateTelemetryDom() {
    $('val-vx').textContent = formatVal(telemetry.vx, t('mps'));
    $('val-vy').textContent = formatVal(telemetry.vy, t('mps'));
    $('val-wz').textContent = formatVal(telemetry.wz, t('radps'));
    $('val-posx').textContent = formatVal(telemetry.posx, t('meter'));
    $('val-posy').textContent = formatVal(telemetry.posy, t('meter'));
    $('val-yaw').textContent = formatVal(telemetry.yaw, t('deg'), 1);
    $('val-gx').textContent = formatVal(telemetry.gx, t('radps'), 3);
    $('val-gy').textContent = formatVal(telemetry.gy, t('radps'), 3);
    $('val-gz').textContent = formatVal(telemetry.gz, t('radps'), 3);
    $('val-ax').textContent = formatVal(telemetry.ax, t('mps2'));
    $('val-ay').textContent = formatVal(telemetry.ay, t('mps2'));
    $('val-az').textContent = formatVal(telemetry.az, t('mps2'));
    $('val-voltage').textContent = formatVal(telemetry.voltage, t('volt'), 1);
    $('val-c0').textContent = formatVal(telemetry.c0, t('amp'), 3);
    $('val-c1').textContent = formatVal(telemetry.c1, t('amp'), 3);
    $('val-c2').textContent = formatVal(telemetry.c2, t('amp'), 3);
    $('val-wa').textContent = formatVal(telemetry.wa, t('mps'), 3);
    $('val-wb').textContent = formatVal(telemetry.wb, t('mps'), 3);
    $('val-wc').textContent = formatVal(telemetry.wc, t('mps'), 3);
    $('val-heading').textContent = formatVal(telemetry.heading, '', 1);

    // Drive view telemetry
    if (dom.driveValVx) dom.driveValVx.textContent = formatVal(telemetry.vx, t('mps'));
    if (dom.driveValVy) dom.driveValVy.textContent = formatVal(telemetry.vy, t('mps'));
    if (dom.driveValWz) dom.driveValWz.textContent = formatVal(telemetry.wz, t('radps'));
    if (dom.driveValVoltage) dom.driveValVoltage.textContent = formatVal(telemetry.voltage, t('volt'), 1);
    if (dom.driveValHeading) dom.driveValHeading.textContent = formatVal(telemetry.heading, '', 1);
    if (dom.driveValMult) dom.driveValMult.textContent = '×' + state.drive.mult.toFixed(2);
    if (dom.driveValControl) dom.driveValControl.textContent = state.drive.controlStatus || t('idle');
    if (dom.driveValCruise) dom.driveValCruise.textContent = state.cruise.status || t('cruiseOff');
    var chartHeadingValue = $('chart-heading-value');
    if (chartHeadingValue) chartHeadingValue.textContent = formatVal(telemetry.heading, '', 1);

    // Heading compass needle
    if (telemetry.heading != null && isFinite(telemetry.heading)) {
      var needle = document.getElementById('heading-needle');
      if (needle) {
        needle.setAttribute('transform', 'rotate(' + telemetry.heading + ', 60, 60)');
      }
      var chartNeedle = document.getElementById('chart-heading-needle');
      if (chartNeedle) {
        chartNeedle.setAttribute('transform', 'rotate(' + telemetry.heading + ', 60, 60)');
      }
    }
  }

  function inferenceApi() {
    return window.electronAPI && window.electronAPI.inference ? window.electronAPI.inference : null;
  }

  function converterApi() {
    return window.electronAPI && window.electronAPI.converter ? window.electronAPI.converter : null;
  }

  function updateModelConvertDom() {
    var converter = state.modelConverter;
    if (dom.btnModelConvert) {
      dom.btnModelConvert.disabled = !!converter.running;
      dom.btnModelConvert.textContent = converter.running ? t('convertingModel') : t('convertModel');
    }
    if (dom.modelConvertLog) {
      dom.modelConvertLog.textContent = converter.lastError || converter.log || '--';
    }
  }

  function formatPercent(v) {
    if (v == null || !isFinite(v)) return t('noData');
    return (v * 100).toFixed(1) + '%';
  }

  function setInferenceText(field, text) {
    var legacy = {
      class: dom.inferClass,
      confidence: dom.inferConfidence,
      backend: dom.inferBackend,
      device: dom.inferDevice,
      latency: dom.inferLatency,
      window: dom.inferWindow,
      error: dom.inferError,
    }[field];
    if (legacy) legacy.textContent = text;
    document.querySelectorAll('[data-infer="' + field + '"]').forEach(function (el) {
      el.textContent = text;
    });
  }

  function setInferenceProbs(html) {
    if (dom.inferProbs) dom.inferProbs.innerHTML = html;
    document.querySelectorAll('[data-infer-probs]').forEach(function (el) {
      el.innerHTML = html;
    });
  }

  function updateInferenceDom() {
    var inf = state.inference;
    var result = inf.lastResult || {};
    var readyText = inf.rows.length >= inf.windowSize ? t('windowReady') : (t('windowPreparing') + ' ' + inf.rows.length + '/' + inf.windowSize);
    if (inf.missingReason) readyText = inf.missingReason;

    setInferenceText('class', result.class_name || t('noData'));
    setInferenceText('confidence', formatPercent(result.confidence));
    setInferenceText('backend', result.backend || inf.backend || '--');
    setInferenceText('device', result.device || inf.device || '--');
    setInferenceText('latency', result.latency_ms != null ? Number(result.latency_ms).toFixed(1) + ' ms' : t('noData'));
    setInferenceText('window', readyText);
    setInferenceText('error', inf.lastError || inf.statusText || '--');
    if (dom.inferenceSettingsStatus) dom.inferenceSettingsStatus.textContent = inf.lastError || inf.statusText || '--';

    var labels = ['normal', 'wheel_slip', 'drive_abnormal', 'shaft_eccentricity'];
    var probs = result.probabilities || [];
    var probHtml = labels.map(function (label, index) {
      var p = Number(probs[index] || 0);
      var width = Math.max(0, Math.min(100, p * 100)).toFixed(1);
      return '<div class="prob-row">' +
        '<span class="prob-label" title="' + escHtml(label) + '">' + escHtml(label) + '</span>' +
        '<span class="prob-bar"><span class="prob-fill" style="width:' + width + '%"></span></span>' +
        '<span class="prob-value">' + formatPercent(p) + '</span>' +
        '</div>';
    }).join('');
    setInferenceProbs(probHtml);
    updateFaultAlarmDom();
  }

  function formatAlarmTime(value) {
    if (!value) return '--';
    try { return new Date(value).toLocaleString(); }
    catch (_) { return value; }
  }

  function currentAlarmStateText() {
    var alarm = state.faultAlarm;
    if (alarm.latched) return t('faultAlarmLatched');
    if (alarm.enabled) return t('faultAlarmMonitoring');
    return t('faultAlarmDisabled');
  }

  function updateFaultAlarmDom() {
    var alarm = state.faultAlarm;
    setInferenceText('alarm-state', currentAlarmStateText());
    setInferenceText('alarm-fault', alarm.faultClass || '--');
    setInferenceText('alarm-confidence', alarm.confidence == null ? '--' : formatPercent(alarm.confidence));
    setInferenceText('alarm-first-at', formatAlarmTime(alarm.firstAt || alarm.candidateFirstAt));
    setInferenceText('alarm-last-at', formatAlarmTime(alarm.lastAt));
    setInferenceText('alarm-count', Math.min(alarm.consecutive, alarm.threshold) + '/' + alarm.threshold);

    if (dom.statusbarFaultEnableBtn) {
      dom.statusbarFaultEnableBtn.textContent = alarm.enabled ? t('faultAlarmStatusOn') : t('faultAlarmStatusOff');
      dom.statusbarFaultEnableBtn.classList.toggle('active', alarm.enabled);
      dom.statusbarFaultEnableBtn.classList.toggle('latched', alarm.latched);
      dom.statusbarFaultEnableBtn.title = currentAlarmStateText();
    }
    if (dom.statusbarFaultResetBtn) {
      dom.statusbarFaultResetBtn.textContent = t('faultAlarmReset');
      dom.statusbarFaultResetBtn.disabled = !alarm.latched;
      dom.statusbarFaultResetBtn.classList.toggle('flash', alarm.latched);
      dom.statusbarFaultResetBtn.title = alarm.latched ? t('faultAlarmReset') : t('faultAlarmNoLatched');
    }
  }

  function faultAlarmDetail(result, timestamp) {
    return {
      className: result.class_name || '',
      confidence: result.confidence == null ? null : Number(result.confidence),
      probabilities: result.probabilities || [],
      backend: result.backend || state.inference.backend,
      device: result.device || state.inference.device,
      latencyMs: result.latency_ms == null ? null : Number(result.latency_ms),
      timestamp: timestamp,
    };
  }

  function clearFaultAlarm(options) {
    var opts = options || {};
    var wasLatched = state.faultAlarm.latched;
    state.faultAlarm.latched = false;
    state.faultAlarm.consecutive = 0;
    state.faultAlarm.candidateFirstAt = '';
    state.faultAlarm.faultClass = '';
    state.faultAlarm.confidence = null;
    state.faultAlarm.firstAt = '';
    state.faultAlarm.lastAt = '';
    state.faultAlarm.detail = null;
    updateFaultAlarmDom();
    resetInferenceWindow('fault_alarm_reset');
    if (opts.log && wasLatched) {
      addLog(opts.log, opts.cls || 'event-subscribed');
      dbAddSyncEvent(opts.eventType || 'fault_alarm_reset', { reason: opts.reason || 'manual', at: new Date().toISOString() });
    }
  }

  function setFaultAlarmEnabled(enabled) {
    state.faultAlarm.enabled = !!enabled;
    saveStored('faultAlarmEnabled', state.faultAlarm.enabled ? 'true' : 'false');
    dbSetSetting('faultAlarmEnabled', state.faultAlarm.enabled ? 'true' : 'false');
    if (!state.faultAlarm.enabled) {
      clearFaultAlarm({
        log: t('faultAlarmDisabledCleared'),
        cls: 'event-disconnected',
        eventType: 'fault_alarm_disabled',
        reason: 'disabled',
      });
    }
    updateFaultAlarmDom();
  }

  function toggleFaultAlarmEnabled() {
    setFaultAlarmEnabled(!state.faultAlarm.enabled);
  }

  function resetFaultAlarmManual() {
    clearFaultAlarm({
      log: t('faultAlarmResetLogged'),
      cls: 'event-subscribed',
      eventType: 'fault_alarm_reset',
      reason: 'manual',
    });
  }

  function latchFaultAlarm(result, timestamp) {
    var alarm = state.faultAlarm;
    alarm.latched = true;
    alarm.faultClass = result.class_name || '--';
    alarm.confidence = result.confidence == null ? null : Number(result.confidence);
    alarm.firstAt = alarm.candidateFirstAt || timestamp;
    alarm.lastAt = timestamp;
    alarm.detail = faultAlarmDetail(result, timestamp);
    if (state.cruise && state.cruise.active) stopCruise();
    stopManualDrive();
    addLog(t('faultAlarmLatchedLog') + ': ' + alarm.faultClass + ' ' + formatPercent(alarm.confidence), 'event-error');
    dbAddSyncEvent('fault_alarm_latched', alarm.detail);
    updateFaultAlarmDom();
  }

  function evaluateFaultAlarm(result) {
    var alarm = state.faultAlarm;
    if (!alarm.enabled || !result) {
      if (!alarm.latched) {
        alarm.consecutive = 0;
        alarm.candidateFirstAt = '';
        updateFaultAlarmDom();
      }
      return;
    }
    var className = String(result.class_name || 'normal');
    var normalClasses = { normal: true, normal_static: true };
    var isFault = className && !normalClasses[className];
    if (!isFault) {
      if (!alarm.latched) {
        alarm.faultClass = '';
        alarm.confidence = null;
        alarm.candidateFirstAt = '';
      }
      alarm.consecutive = 0;
      updateFaultAlarmDom();
      return;
    }

    if (alarm.latched) {
      updateFaultAlarmDom();
      return;
    }

    var now = new Date().toISOString();
    if (alarm.faultClass !== className) {
      alarm.consecutive = 0;
      alarm.candidateFirstAt = '';
    }
    if (alarm.consecutive === 0) alarm.candidateFirstAt = now;
    alarm.consecutive += 1;
    alarm.faultClass = className;
    alarm.confidence = result.confidence == null ? null : Number(result.confidence);
    alarm.lastAt = now;

    if (alarm.consecutive >= alarm.threshold) {
      latchFaultAlarm(result, now);
      return;
    }
    updateFaultAlarmDom();
  }

  function telemetryFeatureRow() {
    var values = [
      telemetry.vx, telemetry.vy, telemetry.wz,
      telemetry.wa, telemetry.wb, telemetry.wc,
      telemetry.ax, telemetry.ay, telemetry.az,
      telemetry.gx, telemetry.gy, telemetry.gz,
      telemetry.c0, telemetry.c1, telemetry.c2,
    ];
    if (![telemetry.wa, telemetry.wb, telemetry.wc].every(function (v) { return v != null && isFinite(v); })) {
      return { error: t('missingWheelSpeed') };
    }
    if (!values.every(function (v) { return v != null && isFinite(v); })) {
      return { error: t('windowPreparing') };
    }
    return { row: values.map(function (v) { return Number(v); }) };
  }

  function resetInferenceWindow(reason) {
    state.inference.rows = [];
    state.inference.samplesSincePredict = 0;
    state.inference.missingReason = reason || '';
    updateInferenceDom();
  }

  function collectInferenceSample() {
    var inf = state.inference;
    var rowResult = telemetryFeatureRow();
    if (rowResult.error) {
      inf.missingReason = rowResult.error;
      updateInferenceDom();
      return;
    }
    inf.missingReason = '';
    inf.rows.push(rowResult.row);
    if (inf.rows.length > inf.windowSize) inf.rows.shift();
    inf.samplesSincePredict += 1;
    updateInferenceDom();

    if (inf.rows.length < inf.windowSize || inf.samplesSincePredict < inf.stepSize || inf.pending) return;
    if (state.faultAlarm.latched) return;
    inf.samplesSincePredict = 0;
    runInferencePredict(inf.rows.slice());
  }

  function loadInferenceModel(manifestPath) {
    var api = inferenceApi();
    if (!api) {
      state.inference.lastError = 'Electron inference API unavailable';
      updateInferenceDom();
      return Promise.resolve();
    }
    var pathValue = (manifestPath || state.inference.manifestPath || '').trim();
    state.inference.statusText = 'loading';
    state.inference.lastError = '';
    updateInferenceDom();
    return api.loadModel(pathValue || undefined).then(function (result) {
      if (result && result.error) throw new Error(result.error);
      state.inference.loaded = true;
      state.inference.statusText = 'model loaded';
      var loadedManifestPath = (result && result.manifestPath) || pathValue;
      if (loadedManifestPath) {
        state.inference.manifestPath = loadedManifestPath;
        saveStored('inferenceManifestPath', loadedManifestPath);
        if (dom.inputInferenceManifest) dom.inputInferenceManifest.value = loadedManifestPath;
      }
      refreshInferenceStatus();
    }).catch(function (e) {
      state.inference.loaded = false;
      state.inference.lastError = e.message || String(e);
      updateInferenceDom();
    });
  }

  function refreshInferenceStatus() {
    var api = inferenceApi();
    if (!api) return Promise.resolve();
    return api.getStatus().then(function (status) {
      if (status && status.error) {
        state.inference.lastError = status.error;
      }
      if (status && status.manifestPath && !state.inference.manifestPath) {
        state.inference.manifestPath = status.manifestPath;
        if (dom.inputInferenceManifest) dom.inputInferenceManifest.value = status.manifestPath;
      }
      return api.backendStatus().catch(function (e) {
        return { error: e.message };
      });
    }).then(function (backendStatus) {
      if (backendStatus && backendStatus.error) {
        state.inference.lastError = backendStatus.error;
      } else if (backendStatus && backendStatus.backend_status) {
        state.inference.backend = backendStatus.backend_status.backend || state.inference.backend;
        state.inference.device = backendStatus.backend_status.device || state.inference.device;
        state.inference.statusText = backendStatus.loaded ? 'ready' : t('modelNotLoaded');
      }
      updateInferenceDom();
    }).catch(function (e) {
      state.inference.lastError = e.message || String(e);
      updateInferenceDom();
    });
  }

  function refreshModelConverterStatus() {
    var api = converterApi();
    if (!api) return Promise.resolve();
    return api.getStatus().then(function (status) {
      if (!status || status.error) {
        state.modelConverter.lastError = status && status.error ? status.error : '';
      } else {
        if (!state.modelConverter.outputDir && status.outputDir) {
          state.modelConverter.outputDir = status.outputDir;
          if (dom.inputModelOutputDir) dom.inputModelOutputDir.value = status.outputDir;
        }
        if (!state.modelConverter.pythonPath && status.pythonPath && dom.inputPythonRuntime) {
          dom.inputPythonRuntime.placeholder = status.pythonPath;
        }
      }
      updateModelConvertDom();
    }).catch(function (e) {
      state.modelConverter.lastError = e.message || String(e);
      updateModelConvertDom();
    });
  }

  function convertModelFromSettings() {
    var api = converterApi();
    if (!api) {
      state.modelConverter.lastError = 'Electron converter API unavailable';
      updateModelConvertDom();
      return Promise.resolve();
    }

    var converter = state.modelConverter;
    converter.modelRoot = dom.inputModelRoot ? dom.inputModelRoot.value.trim() : converter.modelRoot;
    converter.selectedDir = dom.inputSelectedModelDir ? dom.inputSelectedModelDir.value.trim() : converter.selectedDir;
    converter.outputDir = dom.inputModelOutputDir ? dom.inputModelOutputDir.value.trim() : converter.outputDir;
    converter.pythonPath = dom.inputPythonRuntime ? dom.inputPythonRuntime.value.trim() : converter.pythonPath;
    saveStored('modelConverterModelRoot', converter.modelRoot);
    saveStored('modelConverterSelectedDir', converter.selectedDir);
    saveStored('modelConverterOutputDir', converter.outputDir);
    saveStored('modelConverterPythonPath', converter.pythonPath);

    converter.running = true;
    converter.lastError = '';
    converter.log = t('convertingModel');
    updateModelConvertDom();

    return api.convertSageCnn({
      modelRoot: converter.modelRoot,
      selectedDir: converter.selectedDir,
      outputDir: converter.outputDir,
      pythonPath: converter.pythonPath,
      modelName: 'SAGE-CNN selected',
    }).then(function (result) {
      if (result && result.error) throw new Error(result.error);
      var manifestPath = result.manifestPath || '';
      converter.log = [t('modelConverted'), result.stdout || '', manifestPath].filter(Boolean).join('\n');
      state.inference.manifestPath = manifestPath;
      saveStored('inferenceManifestPath', manifestPath);
      if (dom.inputInferenceManifest) dom.inputInferenceManifest.value = manifestPath;
      addLog(t('modelConverted'), 'event-subscribed');
      return loadInferenceModel(manifestPath);
    }).catch(function (e) {
      converter.lastError = e.message || String(e);
      addLog(converter.lastError, 'event-error');
    }).finally(function () {
      converter.running = false;
      updateModelConvertDom();
    });
  }

  function runInferencePredict(windowRows) {
    var api = inferenceApi();
    if (!api) return;
    state.inference.pending = true;
    state.inference.lastError = '';
    updateInferenceDom();
    api.predictWindow(windowRows).then(function (result) {
      if (result && result.error) throw new Error(result.error);
      state.inference.lastResult = result;
      state.inference.backend = result.backend || state.inference.backend;
      state.inference.device = result.device || state.inference.device;
      evaluateFaultAlarm(result);
    }).catch(function (e) {
      state.inference.lastError = e.message || String(e);
    }).finally(function () {
      state.inference.pending = false;
      updateInferenceDom();
    });
  }

  function quatToYaw(q) {
    var w = q.w || 0, x = q.x || 0, y = q.y || 0, z = q.z || 0;
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * 180 / Math.PI;
  }

  function normalizeAngleDeg(angle) {
    var n = Number(angle);
    if (!isFinite(n)) return null;
    while (n >= 180) n -= 360;
    while (n < -180) n += 360;
    return n;
  }

  function headingFromStatus(status) {
    if (!status || status.valid === false) return null;
    var value = status.heading_deg != null ? status.heading_deg : status.heading;
    return normalizeAngleDeg(value);
  }

  function updateHeadingFromImu(msg) {
    var yaw = quatToYaw((msg && msg.orientation) || {});
    telemetry.yaw = yaw;
    if (telemetry.heading == null || !isFinite(telemetry.heading)) {
      telemetry.heading = normalizeAngleDeg(yaw);
      pushHeadingChart();
    }
  }

  // ── Initialize charts ─────────────────────────────
  function initCharts() {
    function waitTopicText(topic) {
      return function () {
        return t('waitingFor') + ' ' + topic + ' ' + t('data');
      };
    }
    var seriesSpeed = [
      { label: 'vx', color: '#3794ff', getValue: function () { return telemetry.vx; } },
      { label: 'vy', color: '#4ec9b0', getValue: function () { return telemetry.vy; } },
      { label: 'wz', color: '#cca700', getValue: function () { return telemetry.wz; } },
    ];
    var seriesCurrent = [
      { label: 'I0', color: '#3794ff', getValue: function () { return telemetry.c0; } },
      { label: 'I1', color: '#4ec9b0', getValue: function () { return telemetry.c1; } },
      { label: 'I2', color: '#cca700', getValue: function () { return telemetry.c2; } },
    ];
    var seriesImu = [
      { label: 'ax', color: '#3794ff', getValue: function () { return telemetry.ax; } },
      { label: 'ay', color: '#4ec9b0', getValue: function () { return telemetry.ay; } },
      { label: 'az', color: '#cca700', getValue: function () { return telemetry.az; } },
    ];
    var chartOptions = { maxPoints: 500, minDrawIntervalMs: 140 };
    state.charts.speed = new TimeSeriesChart($('chart-speed'), seriesSpeed, 60, Object.assign({}, chartOptions, { emptyText: waitTopicText('/odom') }));
    state.charts.dashboardSpeed = new TimeSeriesChart($('speed-chart'), seriesSpeed, 30, Object.assign({}, chartOptions, { emptyText: waitTopicText('/odom'), maxPoints: 300 }));
    state.charts.current = new TimeSeriesChart($('chart-current'), seriesCurrent, 60, Object.assign({}, chartOptions, { emptyText: waitTopicText('/current_data') }));
    state.charts.imu = new TimeSeriesChart($('chart-imu'), seriesImu, 60, Object.assign({}, chartOptions, { emptyText: waitTopicText('IMU') }));

    // Drive-specific chart
    var driveChartCanvas = $('drive-chart');
    if (driveChartCanvas) {
      state.charts.drive = new TimeSeriesChart(driveChartCanvas, seriesSpeed, 30, Object.assign({}, chartOptions, { emptyText: waitTopicText('/odom'), maxPoints: 300 }));
    }

    resizeAllCharts();
  }

  function resizeAllCharts() {
    Object.keys(state.charts).forEach(function (k) {
      state.charts[k].resize();
    });
  }

  function pushChartData() {
    var s = state.charts;
    if (s.speed) s.speed.push([telemetry.vx, telemetry.vy, telemetry.wz]);
    if (s.dashboardSpeed) s.dashboardSpeed.push([telemetry.vx, telemetry.vy, telemetry.wz]);
    if (s.drive) s.drive.push([telemetry.vx, telemetry.vy, telemetry.wz]);
  }
  function pushCurrentChart() {
    if (state.charts.current) state.charts.current.push([telemetry.c0, telemetry.c1, telemetry.c2]);
  }
  function pushImuChart() {
    if (state.charts.imu) state.charts.imu.push([telemetry.ax, telemetry.ay, telemetry.az]);
  }
  function pushHeadingChart() {
    updateTelemetryDom();
  }

  function setChartTimeRange(seconds) {
    Object.keys(state.charts).forEach(function (k) {
      state.charts[k].maxSeconds = seconds;
    });
  }

  // ── Subscriptions ─────────────────────────────────
  function subscribeAll() {
    var client = state.rosClient;
    if (!client) return;

    [
      TOPICS.ODOM, TOPICS.VOLTAGE, TOPICS.CURRENT_DATA, TOPICS.WHEEL_SPEED,
      TOPICS.HEADING_DEG, TOPICS.HEADING_STATUS, TOPICS.CONTROL_STATUS,
      TOPICS.CRUISE_STATUS, TOPICS.COLLECTION_STATUS, TOPICS.CURRENT_READER_STATUS,
      TOPICS.FAULT_STATUS, state.connection.imuTopic,
    ].forEach(function (topic) {
      if (topic) client.unsubscribe(topic);
    });

    client.subscribe(TOPICS.ODOM, 'nav_msgs/Odometry', function (msg) {
      var tw = (msg.twist && msg.twist.twist) || {};
      var po = (msg.pose && msg.pose.pose) || {};
      var ori = po.orientation || {};
      telemetry.vx = tw.linear ? tw.linear.x : null;
      telemetry.vy = tw.linear ? tw.linear.y : null;
      telemetry.wz = tw.angular ? tw.angular.z : null;
      telemetry.posx = po.position ? po.position.x : null;
      telemetry.posy = po.position ? po.position.y : null;
      telemetry.yaw = quatToYaw(ori);
      if (telemetry.heading == null || !isFinite(telemetry.heading)) {
        telemetry.heading = normalizeAngleDeg(telemetry.yaw);
      }
      pushChartData();
      collectInferenceSample();
    });

    subscribeIMU();

    client.subscribe(TOPICS.VOLTAGE, 'std_msgs/Float32', function (msg) {
      telemetry.voltage = msg.data;
    });

    client.subscribe(TOPICS.CURRENT_DATA, 'std_msgs/Float32MultiArray', function (msg) {
      var d = msg.data || [];
      telemetry.c0 = d[0];
      telemetry.c1 = d[1];
      telemetry.c2 = d[2];
      pushCurrentChart();
    });

    client.subscribe(TOPICS.WHEEL_SPEED, 'std_msgs/Float32MultiArray', function (msg) {
      var d = msg.data || [];
      telemetry.wa = d[0];
      telemetry.wb = d[1];
      telemetry.wc = d[2];
    });

    client.subscribe(TOPICS.HEADING_DEG, 'std_msgs/Float32', function (msg) {
      telemetry.heading = msg.data;
      pushHeadingChart();
    });

    client.subscribe(TOPICS.HEADING_STATUS, 'std_msgs/String', function (msg) {
      try {
        var status = JSON.parse(msg.data);
        state.heading.status = status;
        var heading = headingFromStatus(status);
        if (heading != null) {
          telemetry.heading = heading;
          pushHeadingChart();
        }
        updateHeadingStatusUI();
      } catch (_) {
        state.heading.status = { state: msg.data || 'idle' };
        updateHeadingStatusUI();
      }
    });

    // Control status subscriptions
    client.subscribe(TOPICS.CONTROL_STATUS, 'std_msgs/String', function (msg) {
      state.drive.controlStatus = msg.data || '';
    });

    client.subscribe(TOPICS.CRUISE_STATUS, 'std_msgs/String', function (msg) {
      state.cruise.status = msg.data || '';
      state.cruise.active = (msg.data || '').indexOf('cruise: vx') === 0;
      updateCruiseControls();
    });

    // Collection status
    client.subscribe(TOPICS.COLLECTION_STATUS, 'std_msgs/String', function (msg) {
      try {
        var status = JSON.parse(msg.data);
        state.collection.status = status;
        updateCollectionUI();
      } catch (_) {}
    });

    // Current reader status
    client.subscribe(TOPICS.CURRENT_READER_STATUS, 'std_msgs/String', function (msg) {
      try {
        var status = JSON.parse(msg.data);
        state.collection.current = status;
        updateCurrentReaderUI();
      } catch (_) {}
    });

    // Fault injection status
    client.subscribe(TOPICS.FAULT_STATUS, 'std_msgs/String', function (msg) {
      try {
        state.faultInjection.status = JSON.parse(msg.data);
        updateFaultStatusUI();
      } catch (_) {}
    });

    var topics = Object.keys(client.handlers).join(', ');
    addLog(t('subscribed') + ': ' + topics, 'event-subscribed');
  }

  function subscribeIMU() {
    var client = state.rosClient;
    if (!client) return;
    client.subscribe(state.connection.imuTopic, 'sensor_msgs/Imu', function (msg) {
      var av = msg.angular_velocity || {};
      var la = msg.linear_acceleration || {};
      telemetry.gx = av.x; telemetry.gy = av.y; telemetry.gz = av.z;
      telemetry.ax = la.x; telemetry.ay = la.y; telemetry.az = la.z;
      updateHeadingFromImu(msg);
      pushImuChart();
    });
  }

  function switchImuTopic(newTopic) {
    var oldTopic = state.connection.imuTopic;
    if (oldTopic === newTopic) return;
    if (state.rosClient) {
      state.rosClient.unsubscribe(oldTopic);
    }
    state.connection.imuTopic = newTopic;
    saveStored('imuTopic', newTopic);
    if (state.rosClient && state.rosClient.state === 'online') {
      subscribeIMU();
    }
    addLog('IMU topic → ' + newTopic, 'event-subscribed');
  }

  // ── Connection UI ─────────────────────────────────
  var controlButtons = []; // populated in bindEvents

  function setControlButtonsEnabled(enabled) {
    controlButtons.forEach(function (btn) {
      if (btn) btn.disabled = !enabled;
    });
  }

  function setButtonClass(btn, className) {
    if (!btn) return;
    btn.classList.remove('btn-primary', 'btn-secondary', 'btn-warning', 'btn-danger');
    btn.classList.add(className);
  }

  function updateCruiseControls() {
    var online = state.connection.status === 'online';
    var cruising = !!state.cruise.active;
    if (dom.btnCruiseStart) {
      dom.btnCruiseStart.disabled = !online || cruising;
      setButtonClass(dom.btnCruiseStart, cruising ? 'btn-secondary' : 'btn-primary');
    }
    if (dom.btnCruiseStop) {
      dom.btnCruiseStop.disabled = !online || !cruising;
      setButtonClass(dom.btnCruiseStop, cruising ? 'btn-warning' : 'btn-secondary');
    }
  }

  function collectionIsBusy(status) {
    status = status || state.collection.status || {};
    return !!(status.collecting || status.starting ||
      status.state === 'collecting' || status.state === 'running' ||
      status.state === 'starting' || status.state === 'stopping');
  }

  function updateCollectionControls() {
    var online = state.connection.status === 'online';
    var status = state.collection.status || {};
    var busy = collectionIsBusy(status);
    if (dom.btnCollectStart) {
      dom.btnCollectStart.disabled = !online || busy;
      setButtonClass(dom.btnCollectStart, busy ? 'btn-secondary' : 'btn-primary');
    }
    if (dom.btnCollectStop) {
      dom.btnCollectStop.disabled = !online || !busy;
      setButtonClass(dom.btnCollectStop, busy ? 'btn-warning' : 'btn-secondary');
    }
    [
      dom.inputCollectRunid,
      dom.inputCollectOutput,
      dom.inputCurrentPort,
      dom.inputCollectFaultLabel,
      dom.inputCollectFaultMode,
      dom.inputCollectMotion,
      dom.inputCollectRate,
      dom.inputCollectAutostop,
    ].forEach(function (input) {
      if (input) input.disabled = busy;
    });
    if (dom.btnCurrentReconnect) dom.btnCurrentReconnect.disabled = !online || busy;
  }

  function updateConnectionUI(status) {
    state.connection.status = status;
    if (status === 'online' || status === 'error' || status === 'offline') {
      dbRecordConnection(state.connection.ip, status);
    }
    document.body.setAttribute('data-status', status);

    var stateText = t(status === 'online' ? 'online' : status === 'connecting' ? 'connecting' : status === 'error' ? 'error' : 'offline');
    if (dom.statusDetailState) dom.statusDetailState.textContent = stateText;
    if (dom.statusState) dom.statusState.textContent = stateText;

    var urlSpan = dom.statusUrl ? dom.statusUrl.querySelector('span') : null;
    if (urlSpan) {
      urlSpan.textContent = status === 'online' ? 'ws://' + state.connection.ip + ':9090' : t('notConnected');
    }

    if (dom.statusDetailUrl) {
      dom.statusDetailUrl.textContent = status === 'online' ? 'ws://' + state.connection.ip + ':9090' : '--';
    }

    if (dom.btnConnect) dom.btnConnect.disabled = (status === 'connecting' || status === 'online');
    if (dom.btnDisconnect) dom.btnDisconnect.disabled = (status !== 'online');
    if (dom.inputIp) dom.inputIp.disabled = (status === 'connecting' || status === 'online');

    // Enable/disable all control buttons based on connection
    setControlButtonsEnabled(status === 'online');
    updateCruiseControls();
    updateCollectionControls();
    renderDatasetBuilder();

    if (status === 'online' && !state.connectionStartTime) {
      state.connectionStartTime = Date.now();
      startHeartbeat();
    } else if (status !== 'online') {
      state.connectionStartTime = null;
      stopHeartbeat();
      stopDriveLoop();
    }

    if (status === 'online') {
      state.msgCount = 0;
      if (!state._rateInterval) {
        state._rateInterval = setInterval(updateRateDisplay, 1000);
      }
    } else {
      if (state._rateInterval) {
        clearInterval(state._rateInterval);
        state._rateInterval = null;
      }
      state.msgRate = 0;
      if (dom.statusRate) dom.statusRate.textContent = '0 Hz';
      if (dom.statusDetailRate) dom.statusDetailRate.textContent = '0 Hz';
      if (dom.statusDetailUptime) dom.statusDetailUptime.textContent = '--';
    }
  }

  function updateRateDisplay() {
    var client = state.rosClient;
    if (!client) return;
    state.msgRate = client._msgCount;
    client._msgCount = 0;
    var rateText = state.msgRate + ' Hz';
    if (dom.statusRate) dom.statusRate.textContent = rateText;
    if (dom.statusDetailRate) dom.statusDetailRate.textContent = rateText;

    if (dom.statusDetailUptime && state.connectionStartTime) {
      var sec = Math.floor((Date.now() - state.connectionStartTime) / 1000);
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      dom.statusDetailUptime.textContent = m + 'm ' + s + 's';
    }
  }

  // ── Connection History ────────────────────────────
  function addConnectionHistory(ip) {
    var hist = state.connectionHistory;
    var idx = hist.indexOf(ip);
    if (idx !== -1) hist.splice(idx, 1);
    hist.unshift(ip);
    if (hist.length > 10) hist.length = 10;
    saveStored('connectionHistory', JSON.stringify(hist));
    dbRecordConnection(ip, 'attempted');
    renderConnectionHistory();
  }

  function refreshConnectionHistoryFromDb() {
    var db = dbApi();
    if (!db) return;
    db.listConnections(10).then(function (rows) {
      if (!rows || !rows.length) return;
      state.connectionHistory = rows.map(function (row) { return row.ip; });
      saveStored('connectionHistory', JSON.stringify(state.connectionHistory));
      renderConnectionHistory();
    }).catch(function (e) { console.warn('DB error:', e.message); });
  }

  function renderConnectionHistory() {
    if (!dom.connectionHistory) return;
    var hist = state.connectionHistory;
    if (hist.length === 0) {
      dom.connectionHistory.innerHTML = '<div style="color:var(--text-secondary);font-size:11px;padding:4px 0;">--</div>';
      return;
    }
    dom.connectionHistory.innerHTML = hist.map(function (ip) {
      return '<div class="history-item" data-ip="' + escHtml(ip) + '">' + escHtml(ip) + '</div>';
    }).join('');
  }

  // ── View Switching ────────────────────────────────
  function switchActivity(activity) {
    // Stop manual drive when switching away
    if (state.activeActivity === 'drive' && activity !== 'drive') {
      stopManualDrive();
      resetStick();
      stopGamepadPolling();
    }
    state.activeActivity = activity;

    // Restart gamepad polling when switching to drive
    if (activity === 'drive') {
      startGamepadPolling();
    }

    dom.activityBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === activity);
    });

    // Hide all sidebar sections
    var sidebarSections = [dom.sidebarConnection, dom.sidebarStatus, dom.sidebarCharts,
      dom.sidebarSettings, dom.sidebarDrive, dom.sidebarCollect, dom.sidebarExperiment];
    sidebarSections.forEach(function (el) { if (el) el.style.display = 'none'; });

    // Show relevant sections
    if (activity === 'dashboard') {
      if (dom.sidebarConnection) dom.sidebarConnection.style.display = '';
      if (dom.sidebarStatus) dom.sidebarStatus.style.display = '';
    } else if (activity === 'drive') {
      if (dom.sidebarDrive) dom.sidebarDrive.style.display = '';
    } else if (activity === 'charts') {
      if (dom.sidebarCharts) dom.sidebarCharts.style.display = '';
    } else if (activity === 'collect') {
      if (dom.sidebarCollect) dom.sidebarCollect.style.display = '';
    } else if (activity === 'experiment') {
      if (dom.sidebarExperiment) dom.sidebarExperiment.style.display = '';
    } else if (activity === 'settings') {
      if (dom.sidebarSettings) dom.sidebarSettings.style.display = '';
    }

    // Toggle views. Several views are initially hidden with inline display:none,
    // so class changes alone are not enough in Electron/Chromium.
    var views = [dom.viewDashboard, dom.viewDrive, dom.viewCharts, dom.viewCollect, dom.viewExperiment, dom.viewSettings];
    views.forEach(function (v) {
      if (!v) return;
      v.classList.remove('active');
      v.style.display = 'none';
    });

    var activeView = null;
    if (activity === 'dashboard') activeView = dom.viewDashboard;
    else if (activity === 'drive') activeView = dom.viewDrive;
    else if (activity === 'charts') activeView = dom.viewCharts;
    else if (activity === 'collect') {
      activeView = dom.viewCollect;
      loadCSVFiles();
      loadDataSummary();
      refreshActiveCSVPreview(true);
      refreshDatasetBuildHistory();
    }
    else if (activity === 'experiment') { activeView = dom.viewExperiment; updateExperimentSummary(); loadExpCSVFiles(); refreshExperimentHistory(); }
    else if (activity === 'settings') activeView = dom.viewSettings;

    if (activeView) {
      activeView.classList.add('active');
      activeView.style.display = 'flex';
    }

    if (activity === 'dashboard' || activity === 'charts' || activity === 'drive') {
      setTimeout(resizeAllCharts, 50);
    }
  }

  // ── Connect / Disconnect ─────────────────────────
  function connect() {
    var ip = (dom.inputIp.value || '').trim();
    if (!ip || !isValidIp(ip)) {
      addLog('Invalid IP address', 'event-error');
      return;
    }
    state.connection.ip = ip;
    saveStored('lastIp', ip);
    dbSetSetting('lastIp', ip);

    if (!state.rosClient) {
      state.rosClient = new RosClient({
        log: addLog,
        translate: t,
      onDisconnect: function () {
        stopHeartbeat();
        stopDriveLoop();
        dbRecordConnection(state.connection.ip, 'disconnected');
      },
      });
      state.rosClient.onStateChange = updateConnectionUI;
      state.rosClient.onMessage = updateTelemetryDom;
      state.rosClient.onOpen = subscribeAll;
    }

    state.rosClient.connect(ip);
    addConnectionHistory(ip);
  }

  function disconnect() {
    stopDriveLoop();
    stopCollection();
    resetInferenceWindow(t('notConnected'));
    if (state.rosClient) {
      state.rosClient.disconnect();
    }
    if (state._rateInterval) {
      clearInterval(state._rateInterval);
      state._rateInterval = null;
    }
    updateRateDisplay();
  }

  function isValidIp(ip) {
    return /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
  }

  // ── D-pad Canvas (Joystick) ───────────────────────
  var dpadState = { dragging: false, x: 0, y: 0, cx: 0, cy: 0, r: 0 };

  function drawDpad() {
    var canvas = dom.dpadCanvas;
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || canvas.clientWidth || canvas.width || 200;
    var h = rect.height || canvas.clientHeight || canvas.height || 200;
    if (w < 16 || h < 16) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var cx = w / 2, cy = h / 2, r = Math.max(1, Math.min(w, h) / 2 - 6);
    dpadState.cx = cx; dpadState.cy = cy; dpadState.r = r;

    var style = getComputedStyle(document.documentElement);
    var bg = style.getPropertyValue('--input-bg').trim() || '#3c3c3c';
    var border = style.getPropertyValue('--panel-border').trim() || '#2d2d2d';
    var accent = style.getPropertyValue('--accent').trim() || '#007acc';

    ctx.clearRect(0, 0, w, h);

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cross hairs
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();
    ctx.setLineDash([]);

    // Stick position
    var sx = cx + dpadState.x * r;
    var sy = cy - dpadState.y * r;
    ctx.beginPath();
    ctx.arc(sx, sy, 12, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function setStick(clientX, clientY) {
    var canvas = dom.dpadCanvas;
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var x = (clientX - rect.left - dpadState.cx) / dpadState.r;
    var y = (dpadState.cy - (clientY - rect.top)) / dpadState.r;
    // Clamp to unit circle
    var mag = Math.sqrt(x * x + y * y);
    if (mag > 1) { x /= mag; y /= mag; }

    dpadState.x = x;
    dpadState.y = y;
    state.drive.stick = { x: x, y: y };
    drawDpad();

    // Activate drive if not already
    if (mag > 0.05 && !state.drive.driveActive) {
      startManualDrive();
    }
  }

  function resetStick() {
    dpadState.x = 0;
    dpadState.y = 0;
    state.drive.stick = { x: 0, y: 0 };
    drawDpad();
  }

  function initDpad() {
    var canvas = dom.dpadCanvas;
    if (!canvas) return;
    drawDpad();

    canvas.addEventListener('mousedown', function (e) {
      dpadState.dragging = true;
      setStick(e.clientX, e.clientY);
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!dpadState.dragging) return;
      setStick(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', function () {
      if (!dpadState.dragging) return;
      dpadState.dragging = false;
      resetStick();
    });

    // Touch support
    canvas.addEventListener('touchstart', function (e) {
      dpadState.dragging = true;
      setStick(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    });

    canvas.addEventListener('touchmove', function (e) {
      if (!dpadState.dragging) return;
      setStick(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    });

    canvas.addEventListener('touchend', function () {
      dpadState.dragging = false;
      resetStick();
    });

    // Resize observer for DPI changes
    if (window.ResizeObserver) {
      new ResizeObserver(function () { drawDpad(); }).observe(canvas);
    }
  }

  // ── Manual Drive Control ──────────────────────────
  function startManualDrive() {
    if (state.drive.estopActive) return;
    state.drive.driveActive = true;
    startDriveLoop();
  }

  function stopManualDrive() {
    state.drive.driveActive = false;
    stopDriveLoop();
    resetStick();
  }

  function toggleEstop() {
    state.drive.estopActive = !state.drive.estopActive;
    if (dom.estopIndicator) {
      dom.estopIndicator.style.display = state.drive.estopActive ? '' : 'none';
    }
    if (dom.btnEstop) {
      dom.btnEstop.textContent = state.drive.estopActive ? t('estopInactive') : t('estop');
    }

    if (state.rosClient && state.connection.status === 'online') {
      state.rosClient.publish(TOPICS.ESTOP, { data: state.drive.estopActive });
    }

    if (state.drive.estopActive) {
      stopManualDrive();
      addLog(t('estopActive'), 'event-error');
    } else {
      addLog(t('estopInactive'), '');
    }
  }

  // ── Keyboard Handling ─────────────────────────────
  function isEditableTarget(target) {
    if (!target) return false;
    var tag = target.tagName;
    return target.isContentEditable || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  }

  function setKeyState(e, pressed) {
    if (e.code) state.keys[e.code] = pressed;
    if (e.key) state.keys[String(e.key).toLowerCase()] = pressed;
  }

  function onKeyDown(e) {
    // Drive keys only active in drive view
    if (state.activeActivity !== 'drive') return;
    // Ignore if typing in an input
    if (isEditableTarget(e.target)) return;
    var keyId = e.code || String(e.key || '').toLowerCase();
    if (state.keys[keyId] === true) return; // ignore repeats
    setKeyState(e, true);

    // Speed multiplier keys
    if (e.code === 'Digit1' || e.key === '1') { state.drive.mult = 0.25; if (dom.selectSpeedMult) dom.selectSpeedMult.value = '0.25'; return; }
    if (e.code === 'Digit2' || e.key === '2') { state.drive.mult = 0.50; if (dom.selectSpeedMult) dom.selectSpeedMult.value = '0.50'; return; }
    if (e.code === 'Digit3' || e.key === '3') { state.drive.mult = 1.00; if (dom.selectSpeedMult) dom.selectSpeedMult.value = '1.00'; return; }

    // Space: stop
    if (e.key === ' ') {
      stopManualDrive();
      e.preventDefault();
      return;
    }

    // Escape: estop toggle
    if (e.key === 'Escape') {
      toggleEstop();
      return;
    }

    updateDriveFromKeys();
  }

  function onKeyUp(e) {
    setKeyState(e, false);
    updateDriveFromKeys();
  }

  function updateDriveFromKeys() {
    var k = state.keys;
    var y = 0, x = 0;

    if (k.KeyW || k.w || k.ArrowUp) y += 1;
    if (k.KeyS || k.s || k.ArrowDown) y -= 1;
    if (k.KeyA || k.a || k.ArrowLeft) x -= 1;
    if (k.KeyD || k.d || k.ArrowRight) x += 1;

    var mag = Math.sqrt(x * x + y * y);
    if (mag > 1) { x /= mag; y /= mag; }

    state.drive.stick = { x: x, y: y };

    // Lateral
    var lat = 0;
    if (k.KeyQ || k.q) lat -= 1;
    if (k.KeyE || k.e) lat += 1;
    state.drive.lateral = lat;
    if (dom.inputStrafe) dom.inputStrafe.value = lat * 100;

    if (mag > 0.05 || Math.abs(lat) > 0.05) {
      if (!state.drive.driveActive) startManualDrive();
    } else if (state.drive.driveActive && !dpadState.dragging) {
      stopManualDrive();
    }

    // Update D-pad display
    dpadState.x = x;
    dpadState.y = y;
    drawDpad();
  }

  // ── Gamepad Support ───────────────────────────────
  var gamepadRafId = null;

  function gamepadAxis(gp, index) {
    var value = gp.axes && gp.axes[index];
    return isFinite(value) ? value : 0;
  }

  function gamepadButtonValue(gp, index) {
    var button = gp.buttons && gp.buttons[index];
    if (!button) return 0;
    return typeof button.value === 'number' ? button.value : (button.pressed ? 1 : 0);
  }

  function gamepadButtonPressed(gp, index) {
    var button = gp.buttons && gp.buttons[index];
    return !!(button && button.pressed);
  }

  function pollGamepad() {
    var gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    var found = false;

    for (var i = 0; i < gamepads.length; i++) {
      var gp = gamepads[i];
      if (!gp) continue;
      found = true;

      // Only process gamepad input in drive view
      if (state.activeActivity !== 'drive') break;

      // Standard Xbox mapping in Chromium:
      // left stick = axes 0/1, right stick X = axis 2, triggers = buttons 6/7.
      var leftX = gamepadAxis(gp, 0);
      var leftY = gamepadAxis(gp, 1);
      var rightX = gamepadAxis(gp, 2);
      var rt = gamepadButtonValue(gp, 7);

      // Deadband
      if (Math.abs(leftX) < 0.1) leftX = 0;
      if (Math.abs(leftY) < 0.1) leftY = 0;
      if (Math.abs(rightX) < 0.1) rightX = 0;
      if (rt < 0.05) rt = 0;

      state.drive.stick = { x: leftX, y: -leftY };
      state.drive.lateral = rightX;
      state.drive.mult = rt > 0 ? 0.25 + rt * 0.75 : parseFloat(dom.selectSpeedMult ? dom.selectSpeedMult.value : state.drive.mult) || state.drive.mult;

      // A button = stop
      if (gamepadButtonPressed(gp, 0)) {
        stopManualDrive();
      }

      // Start button = estop toggle
      if (gamepadButtonPressed(gp, 9) && !state._lastStartPressed) {
        toggleEstop();
      }
      state._lastStartPressed = gamepadButtonPressed(gp, 9);

      var mag = Math.sqrt(leftX * leftX + leftY * leftY + rightX * rightX);
      if (mag > 0.1) {
        if (!state.drive.driveActive) startManualDrive();
      } else if (state.drive.driveActive && !dpadState.dragging) {
        // Stop drive loop when sticks return to center
        stopManualDrive();
      }

      break;
    }

    updateGamepadConnected(found);

    // Only schedule next frame if in drive view
    if (state.activeActivity === 'drive') {
      gamepadRafId = requestAnimationFrame(pollGamepad);
    } else {
      gamepadRafId = null;
    }
  }

  function startGamepadPolling() {
    if (!gamepadRafId) {
      gamepadRafId = requestAnimationFrame(pollGamepad);
    }
  }

  function stopGamepadPolling() {
    if (gamepadRafId) {
      cancelAnimationFrame(gamepadRafId);
      gamepadRafId = null;
    }
  }

  // ── Gamepad UI update ─────────────────────────────
  function updateGamepadConnected(found) {
    if (found !== state.gamepad.connected) {
      state.gamepad.connected = found;
      if (found) {
        state.gamepad.gamepadIndex = 0;
        addLog(t('gamepadConnected'), 'event-connected');
      } else {
        state.gamepad.gamepadIndex = -1;
        addLog(t('gamepadDisconnected'), 'event-disconnected');
      }
      updateGamepadUI();
    }
  }

  function updateGamepadUI() {
    if (dom.statusGamepad) {
      dom.statusGamepad.style.display = state.gamepad.connected ? '' : 'none';
    }
  }

  // ── Cruise Control ────────────────────────────────
  function startCruise() {
    var speed = parseFloat(dom.inputCruiseSpeed.value) || 0.2;
    var dir = state.cruise.direction;
    state.cruise.speed = speed;

    if (state.rosClient && state.connection.status === 'online') {
      state.cruise.active = true;
      updateCruiseControls();
      state.rosClient.publish(TOPICS.CRUISE_CMD, {
        linear: { x: dir.x * speed, y: dir.y * speed, z: 0 },
        angular: { x: 0, y: 0, z: 0 },
      });
      state.rosClient.publish(TOPICS.CRUISE_ENABLE, { data: true });
    }
  }

  function stopCruise() {
    if (state.rosClient && state.connection.status === 'online') {
      state.cruise.active = false;
      updateCruiseControls();
      state.rosClient.publish(TOPICS.CRUISE_ENABLE, { data: false });
    }
  }

  function setCruiseDirection(dx, dy) {
    state.cruise.direction = { x: dx, y: dy };
    // Update button active states
    var buttons = dom.cruiseDirGrid.querySelectorAll('.cruise-dir-btn');
    buttons.forEach(function (btn) {
      var bdx = parseInt(btn.dataset.dx);
      var bdy = parseInt(btn.dataset.dy);
      btn.classList.toggle('active', bdx === dx && bdy === dy);
    });
  }

  // ── Heading Control ───────────────────────────────
  function sendHeadingAngle() {
    var angle = parseFloat(dom.inputHeadingAngle.value);
    if (isNaN(angle)) return;
    state.heading.targetAngle = angle;

    if (state.rosClient && state.connection.status === 'online') {
      state.rosClient.publish(TOPICS.TARGET_ANGLE, { data: angle });
    }
    state.heading.angleState = 'heading: ' + angle.toFixed(1) + '°';
    if (dom.headingStateText) dom.headingStateText.textContent = state.heading.angleState;
  }

  function resetHeadingZero() {
    if (state.rosClient && state.connection.status === 'online') {
      state.rosClient.publish(TOPICS.HEADING_ZERO, {});
    }
    if (dom.headingStateText) dom.headingStateText.textContent = 'heading: set zero';
  }

  function updateHeadingStatusUI() {
    var s = state.heading.status || {};
    var parts = [];
    if (s.state) parts.push(s.state);
    if (s.mode) parts.push(s.mode);
    if (s.source) parts.push(s.source);
    var heading = headingFromStatus(s);
    if (heading != null) {
      parts.push(heading.toFixed(1) + ' deg');
    }
    if (s.zero_offset != null && isFinite(Number(s.zero_offset))) {
      parts.push('zero=' + Number(s.zero_offset).toFixed(1));
    }
    if (dom.headingStateText) {
      dom.headingStateText.textContent = parts.length ? 'heading: ' + parts.join(' / ') : 'heading: idle';
    }
  }

  function faultTypeFromLabel(label) {
    if (label === 1) return 'drive_abnormal';
    if (label === 2) return 'wheel_slip';
    if (label === 3) return 'shaft_eccentric';
    return 'normal';
  }

  function selectedFaultWheel(wheels) {
    wheels = wheels || {};
    if (wheels.B) return 'B';
    if (wheels.A) return 'A';
    if (wheels.C) return 'C';
    return 'none';
  }

  function selectedFaultAlpha(wheel, alpha) {
    alpha = alpha || {};
    return wheel && wheel !== 'none' ? Number(alpha[wheel] || 1.0) : 1.0;
  }

  // ── Data Collection ───────────────────────────────
  function startCollection() {
    state.collection.currentPort = dom.inputCurrentPort ? (dom.inputCurrentPort.value || state.collection.currentPort) : state.collection.currentPort;
    state.collection.faultLabel = parseInt(dom.inputCollectFaultLabel.value) || 0;
    var config = {
      output_dir: dom.inputCollectOutput.value || state.collection.outputDir,
      run_id: dom.inputCollectRunid.value || '',
      fault_label: state.collection.faultLabel,
      fault_name: dom.inputCollectFaultLabel.options[dom.inputCollectFaultLabel.selectedIndex].text.split(' - ')[1] || 'normal',
      fault_mode: parseInt(dom.inputCollectFaultMode.value) || 0,
      fault_type: faultTypeFromLabel(state.collection.faultLabel),
      fault_wheel: 'none',
      fault_alpha: 1.0,
      motion_mode: dom.inputCollectMotion.value,
      expected_rate: parseInt(dom.inputCollectRate.value) || 20,
    };

    if (state.rosClient && state.connection.status === 'online') {
      state.collection.status = Object.assign({}, state.collection.status, {
        state: 'starting',
        collecting: false,
        sample_id: 0,
        error: '',
      });
      updateCollectionUI();
      state.rosClient.publish(TOPICS.CURRENT_READER_CONFIG, { data: JSON.stringify({ port: state.collection.currentPort, reconnect: true }) });
      state.rosClient.publish(TOPICS.COLLECTION_CONFIG, { data: JSON.stringify(config) });
      setTimeout(function () {
        state.rosClient.publish(TOPICS.COLLECTION_ENABLE, { data: true });
      }, 100);
      addLog('Collection started', 'event-subscribed');
    } else {
      addLog('Collection start ignored: ROS is not connected', 'event-error');
    }

    // Auto-stop
    var autoStop = parseInt(dom.inputCollectAutostop.value) || 0;
    if (autoStop > 0) {
      if (state.collection.autoStopTimer) clearTimeout(state.collection.autoStopTimer);
      state.collection.autoStopTimer = setTimeout(function () {
        stopCollection();
      }, autoStop * 1000);
    }
  }

  function stopCollection() {
    if (state.rosClient && state.connection.status === 'online') {
      state.collection.status = Object.assign({}, state.collection.status, {
        state: 'stopping',
      });
      updateCollectionUI();
      state.rosClient.publish(TOPICS.COLLECTION_ENABLE, { data: false });
    }
    if (state.collection.autoStopTimer) {
      clearTimeout(state.collection.autoStopTimer);
      state.collection.autoStopTimer = null;
    }
    if (state.collection._csvRefreshTimer) {
      clearInterval(state.collection._csvRefreshTimer);
      state.collection._csvRefreshTimer = null;
    }
    addLog('Collection stopped', 'event-disconnected');
  }

  function updateCollectionUI() {
    var s = state.collection.status;
    if (dom.collectStateText) {
      var cls = s.collecting ? 'collect-state-collecting' : 'collect-state-idle';
      dom.collectStateText.innerHTML = '<span class="' + cls + '">●</span> ' + (s.state || 'idle');
    }
    if (dom.collectRowsText) dom.collectRowsText.textContent = String(s.sample_id || 0);
    if (s.error && s.error !== state.collection.lastCollectionErrorLogged) {
      state.collection.lastCollectionErrorLogged = s.error;
      addLog('Collection error: ' + s.error, 'event-error');
    } else if (!s.error) {
      state.collection.lastCollectionErrorLogged = '';
    }

    function qualityNumber() {
      for (var i = 0; i < arguments.length; i++) {
        var v = arguments[i];
        if (v != null && v !== '' && isFinite(Number(v))) return Number(v);
      }
      return null;
    }
    function rememberQuality(key, value) {
      state.collection.lastQuality = state.collection.lastQuality || {};
      if (value != null && isFinite(value)) state.collection.lastQuality[key] = value;
      return state.collection.lastQuality[key];
    }

    // Update quality metrics. Keep the last published values visible after the collector stops.
    var rateValue = rememberQuality('rate_hz', qualityNumber(s.rate_hz, s.rate, s.sample_rate_hz, s.actual_rate_hz));
    var driftValue = rememberQuality('clock_drift_ms', qualityNumber(s.clock_drift_ms, s.clock_drift, s.sync_drift_ms));
    var ageValue = rememberQuality('data_age_sec', qualityNumber(s.data_age_sec, s.data_age, s.max_data_age_sec));
    if (dom.qualityRateText) dom.qualityRateText.textContent = rateValue != null ? Number(rateValue).toFixed(1) + ' Hz' : '--';
    if (dom.qualityDriftText) dom.qualityDriftText.textContent = driftValue != null ? Number(driftValue).toFixed(1) + ' ms' : 'n/a';
    if (dom.qualityAgeText) dom.qualityAgeText.textContent = ageValue != null ? Number(ageValue).toFixed(1) + ' s' : '--';
    if (dom.qualityDurationText) {
      var dur = rememberQuality('duration_sec', qualityNumber(s.duration_sec, s.duration, s.elapsed_sec));
      if (dur != null && dur > 0) {
        var m = Math.floor(dur / 60);
        var sec = Math.floor(dur % 60);
        dom.qualityDurationText.textContent = m + 'm ' + sec + 's';
      } else {
        dom.qualityDurationText.textContent = '--';
      }
    }

    function shouldRefreshCollectCsv() {
      return state.activeActivity === 'collect' ||
        (dom.viewCollect && (dom.viewCollect.classList.contains('active') || dom.viewCollect.style.display === 'flex'));
    }

    // Start/stop periodic CSV refresh based on collection state
    if (s.collecting && !state.collection._csvRefreshTimer) {
      loadCSVFiles();
      loadDataSummary();
      refreshActiveCSVPreview(true);
      state.collection._csvRefreshTimer = setInterval(function () {
        if (shouldRefreshCollectCsv()) {
          loadCSVFiles();
          loadDataSummary();
          refreshActiveCSVPreview(false);
        }
        if (state.activeActivity === 'experiment') {
          loadExpCSVFiles();
        }
      }, 2000);
    } else if (!s.collecting && state.collection._csvRefreshTimer) {
      clearInterval(state.collection._csvRefreshTimer);
      state.collection._csvRefreshTimer = null;
      // Final refresh when collection stops
      if (shouldRefreshCollectCsv()) {
        loadCSVFiles();
        loadDataSummary();
        refreshActiveCSVPreview(true);
      }
      if (state.activeActivity === 'experiment') {
        loadExpCSVFiles();
      }
    }
    if (s.collecting && shouldRefreshCollectCsv()) {
      refreshActiveCSVPreview(false);
    }

    if (state.experiment.running) {
      var rows = collectionRows();
      if (dom.expStatusRows) dom.expStatusRows.textContent = String(rows);
      if (rows !== state.experiment.lastRowsSyncedCount && Date.now() - state.experiment.lastRowsSyncAt > 1000) {
        state.experiment.lastRowsSyncedCount = rows;
        state.experiment.lastRowsSyncAt = Date.now();
        dbUpdateExperiment({ rowsCollected: rows });
      }
    }
    updateCollectionControls();
  }

  function collectionRows() {
    var s = state.collection.status || {};
    return Number(s.sample_id || s.rows || s.row_count || s.collected_rows || 0);
  }

  function updateCurrentReaderUI() {
    var s = state.collection.current;
    if (s.port) state.collection.currentPort = s.port;
    if (dom.currentPortText) dom.currentPortText.textContent = s.port || state.collection.currentPort || '/dev/ttyUSB1';
    if (dom.inputCurrentPort && s.port && document.activeElement !== dom.inputCurrentPort) dom.inputCurrentPort.value = s.port;
    if (dom.currentFramesText) dom.currentFramesText.textContent = String(s.valid_total || 0);
  }

  function reconnectCurrentReader() {
    state.collection.currentPort = dom.inputCurrentPort ? (dom.inputCurrentPort.value || state.collection.currentPort) : state.collection.currentPort;
    if (state.rosClient && state.connection.status === 'online') {
      var config = { port: state.collection.currentPort, reconnect: true };
      state.rosClient.publish(TOPICS.CURRENT_READER_CONFIG, { data: JSON.stringify(config) });
      addLog('Current reader reconnect sent: ' + state.collection.currentPort, 'event-subscribed');
    }
  }

  function toggleAdvanced() {
    state.collection.showAdvanced = !state.collection.showAdvanced;
    if (dom.advancedPanel) dom.advancedPanel.style.display = state.collection.showAdvanced ? '' : 'none';
    if (dom.advancedToggle) {
      dom.advancedToggle.textContent = (state.collection.showAdvanced ? '▾ ' : '▸ ') + t('advanced');
    }
  }

  // ── Fault Injection ───────────────────────────────
  function applyFaultInjection() {
    var enable = parseInt(dom.inputFaultEnable.value) === 1;
    var faultType = dom.inputExperimentFaultType.value;

    state.faultInjection.enableFault = enable;
    state.faultInjection.faultType = faultType;
    state.faultInjection.wheels.A = dom.expWheelA.checked;
    state.faultInjection.wheels.B = dom.expWheelB.checked;
    state.faultInjection.wheels.C = dom.expWheelC.checked;
    state.faultInjection.alpha.A = alphaValue(dom.expAlphaA);
    state.faultInjection.alpha.B = alphaValue(dom.expAlphaB);
    state.faultInjection.alpha.C = alphaValue(dom.expAlphaC);

    var config = {
      enable_fault: enable,
      fault_type: faultType,
      wheels: state.faultInjection.wheels,
      alpha: state.faultInjection.alpha,
    };

    if (state.rosClient && state.connection.status === 'online') {
      // Send JSON config
      state.rosClient.publish(TOPICS.FAULT_CONFIG_WEB, { data: JSON.stringify(config) });

      // Also send Float32MultiArray to /chassis/fault_config
      setTimeout(function () {
        state.rosClient.publish(TOPICS.FAULT_CONFIG_CHASSIS, Experiment.chassisFaultMsg(enable, state.faultInjection.wheels, state.faultInjection.alpha));
      }, 50);

      addLog('Fault injection applied: ' + (enable ? 'ON' : 'OFF'), 'event-subscribed');
    }

    dbAddExperimentEvent('fault_apply', {
      enable: enable,
      faultType: faultType,
      wheels: state.faultInjection.wheels,
      alpha: state.faultInjection.alpha,
      online: state.connection.status === 'online',
    });
    updateFaultStatusUI();
  }

  function resetFaultInjection() {
    if (state.rosClient && state.connection.status === 'online') {
      var resetConfig = Experiment.resetFaultConfig();
      state.rosClient.publish(TOPICS.FAULT_CONFIG_WEB, { data: JSON.stringify(resetConfig) });
      state.rosClient.publish(TOPICS.FAULT_CONFIG_CHASSIS, Experiment.chassisFaultMsg(false, resetConfig.wheels, resetConfig.alpha));
      addLog('Fault injection reset', 'event-disconnected');
    }
    dbAddExperimentEvent('fault_reset', { online: state.connection.status === 'online' });
    if (dom.inputFaultEnable) dom.inputFaultEnable.value = '0';
    if (dom.faultStatusText) dom.faultStatusText.textContent = t('faultIdle');
  }

  function updateFaultStatusUI() {
    if (!dom.faultStatusText) return;
    var enable = parseInt(dom.inputFaultEnable.value) === 1;
    dom.faultStatusText.textContent = enable ? t('faultInjecting') : t('faultIdle');
  }

  // ── Experiment Wizard ─────────────────────────────
  function startExperiment() {
    if (state.experiment.running) return;

    var faultType = dom.inputExperimentFaultType.value;
    var expWheels = {
      A: dom.expWheelA.checked,
      B: dom.expWheelB.checked,
      C: dom.expWheelC.checked,
    };
    var expAlpha = {
      A: alphaValue(dom.expAlphaA),
      B: alphaValue(dom.expAlphaB),
      C: alphaValue(dom.expAlphaC),
    };

    state.experiment.faultType = faultType;
    state.experiment.wheels = expWheels;
    state.experiment.alpha = expAlpha;
    state.experiment.runId = dom.inputExperimentRunid.value || '';
    state.experiment.motionMode = dom.inputExperimentMotion.value;
    state.experiment.durationSec = parseInt(dom.inputExperimentDuration.value) || 60;
    state.experiment.expectedRate = parseInt(dom.inputExperimentRate.value) || 20;
    state.experiment.outputDir = dom.inputExperimentOutput.value;
    state.experiment.running = true;
    state.experiment.localId = null;
    state.experiment.lastRowsSyncedCount = 0;
    state.experiment.lastRowsSyncAt = 0;

    dbStartExperimentRecord({
      robotIp: state.connection.ip,
      runId: state.experiment.runId,
      faultType: faultType,
      wheels: expWheels,
      alpha: expAlpha,
      motionMode: state.experiment.motionMode,
      expectedRate: state.experiment.expectedRate,
      outputDir: state.experiment.outputDir,
      durationSec: state.experiment.durationSec,
      status: 'running',
      rowsCollected: 0,
      config: {
        imuTopic: state.imuTopic,
        apiUrl: state.connection.ip ? ('http://' + state.connection.ip + ':8000') : '',
      },
    });

    if (dom.experimentStatusText) dom.experimentStatusText.textContent = t('experimentRunning');
    if (dom.btnExperimentStart) dom.btnExperimentStart.disabled = true;
    updateExperimentSummary();

    if (state.rosClient && state.connection.status === 'online') {
      // Step 1: Set fault injection config
      var faultConfig = {
        enable_fault: faultType !== 'normal',
        fault_type: faultType,
        wheels: expWheels,
        alpha: expAlpha,
      };
      state.rosClient.publish(TOPICS.FAULT_CONFIG_WEB, { data: JSON.stringify(faultConfig) });

      if (faultType !== 'normal') {
        state.rosClient.publish(TOPICS.FAULT_CONFIG_CHASSIS, Experiment.chassisFaultMsg(true, expWheels, expAlpha));
      } else {
        var normalReset = Experiment.resetFaultConfig();
        state.rosClient.publish(TOPICS.FAULT_CONFIG_CHASSIS, Experiment.chassisFaultMsg(false, normalReset.wheels, normalReset.alpha));
      }

      // Step 2: Set collection config after a delay
      setTimeout(function () {
        var faultWheel = selectedFaultWheel(expWheels);
        var collectConfig = {
          output_dir: state.experiment.outputDir,
          run_id: state.experiment.runId,
          fault_label: faultType === 'normal' ? 0 : (faultType === 'drive_abnormal' ? 1 : (faultType === 'wheel_slip' ? 2 : 3)),
          fault_name: faultType,
          fault_mode: 0,
          fault_type: faultType,
          fault_wheel: faultWheel,
          fault_alpha: selectedFaultAlpha(faultWheel, expAlpha),
          motion_mode: state.experiment.motionMode,
          expected_rate: state.experiment.expectedRate,
        };
        state.rosClient.publish(TOPICS.COLLECTION_CONFIG, { data: JSON.stringify(collectConfig) });

        // Step 3: Start collection
        setTimeout(function () {
          state.rosClient.publish(TOPICS.COLLECTION_ENABLE, { data: true });
          addLog('Experiment started: ' + faultType, 'event-subscribed');
          dbAddExperimentEvent('collection_started', { faultType: faultType });
        }, 100);
      }, 100);
    } else {
      dbAddExperimentEvent('start_offline', { faultType: faultType });
    }

    // Auto-stop
    var duration = state.experiment.durationSec;
    if (duration > 0) {
      if (state.experiment.autoStopTimer) clearTimeout(state.experiment.autoStopTimer);
      state.experiment.autoStopTimer = setTimeout(function () {
        stopExperiment();
      }, duration * 1000);
    }
  }

  function stopExperiment() {
    var wasRunning = state.experiment.running;
    if (state.rosClient && state.connection.status === 'online') {
      state.rosClient.publish(TOPICS.COLLECTION_ENABLE, { data: false });
      // Reset fault injection for safety
      var resetConfig = Experiment.resetFaultConfig();
      state.rosClient.publish(TOPICS.FAULT_CONFIG_WEB, { data: JSON.stringify(resetConfig) });
      state.rosClient.publish(TOPICS.FAULT_CONFIG_CHASSIS, Experiment.chassisFaultMsg(false, resetConfig.wheels, resetConfig.alpha));
    }
    state.experiment.running = false;
    if (state.experiment.autoStopTimer) {
      clearTimeout(state.experiment.autoStopTimer);
      state.experiment.autoStopTimer = null;
    }
    if (dom.experimentStatusText) dom.experimentStatusText.textContent = 'idle';
    if (dom.btnExperimentStart) dom.btnExperimentStart.disabled = false;
    if (wasRunning || state.experiment.localId || state.experiment.pendingRecord) {
      dbFinishExperimentRecord({
        status: 'stopped',
        rowsCollected: collectionRows(),
        stopReason: state.connection.status === 'online' ? 'manual' : 'manual_offline',
      });
      addLog('Experiment stopped', 'event-disconnected');
    }
    loadExpCSVFiles();
  }

  function resetExperiment() {
    stopExperiment();
    if (dom.inputExperimentFaultType) dom.inputExperimentFaultType.value = 'normal';
    if (dom.expWheelA) dom.expWheelA.checked = false;
    if (dom.expWheelB) dom.expWheelB.checked = false;
    if (dom.expWheelC) dom.expWheelC.checked = false;
    if (dom.expAlphaA) dom.expAlphaA.value = '1.00';
    if (dom.expAlphaB) dom.expAlphaB.value = '0.50';
    if (dom.expAlphaC) dom.expAlphaC.value = '1.00';
    if (dom.inputExperimentRunid) dom.inputExperimentRunid.value = '';
    if (dom.inputExperimentDuration) dom.inputExperimentDuration.value = 60;
    updateExperimentSummary();
  }

  function updateExperimentSummary() {
    updateAlphaLabels();
    if (dom.expSummaryType) dom.expSummaryType.textContent = dom.inputExperimentFaultType.value;
    if (dom.expSummaryWheels) {
      var wheels = [];
      if (dom.expWheelA.checked) wheels.push('A(' + alphaText(dom.expAlphaA) + ')');
      if (dom.expWheelB.checked) wheels.push('B(' + alphaText(dom.expAlphaB) + ')');
      if (dom.expWheelC.checked) wheels.push('C(' + alphaText(dom.expAlphaC) + ')');
      dom.expSummaryWheels.textContent = wheels.length > 0 ? wheels.join(', ') : 'none';
    }
    if (dom.expSummaryRunid) dom.expSummaryRunid.textContent = dom.inputExperimentRunid.value || '(auto)';
    if (dom.expSummaryDuration) dom.expSummaryDuration.textContent = dom.inputExperimentDuration.value + 's';
  }

  function alphaText(input) {
    return alphaValue(input).toFixed(2);
  }

  function alphaValue(input) {
    return clampAlphaValue(input ? input.value : 0);
  }

  function clampAlphaValue(value) {
    var n = parseFloat(value);
    if (!isFinite(n)) n = 0;
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    return n;
  }

  function updateAlphaLabels() {
    [dom.expAlphaA, dom.expAlphaB, dom.expAlphaC].forEach(function (input) {
      if (input && document.activeElement !== input) input.value = alphaText(input);
    });
  }

  // ── CSV File Management ───────────────────────────
  function loadCSVFiles() {
    if (dataWorkspace) dataWorkspace.loadCSVFiles();
  }

  function renderCSVTable() {
    if (dataWorkspace) dataWorkspace.renderCSVTable();
  }

  function truncateName(name, maxLen) {
    return dataWorkspace ? dataWorkspace.truncateName(name, maxLen) : (name || '');
  }

  function formatSize(bytes) {
    return dataWorkspace ? dataWorkspace.formatSize(bytes) : String(bytes || 0);
  }

  function previewCSVFile(name) {
    if (dataWorkspace) dataWorkspace.previewCSVFile(name);
  }

  function basenameFromPath(path) {
    var s = String(path || '');
    if (!s) return '';
    var parts = s.split(/[\\/]/);
    return parts[parts.length - 1] || '';
  }

  function csvNameFromRunId(runId) {
    var name = String(runId || '').trim();
    if (!name || name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) return '';
    return /\.csv$/i.test(name) ? name : name + '.csv';
  }

  function refreshActiveCSVPreview(force) {
    var status = state.collection.status || {};
    var name = basenameFromPath(status.filepath || status.file || '') ||
      csvNameFromRunId(status.filename) ||
      csvNameFromRunId(status.run_id) ||
      csvNameFromRunId(dom.inputCollectRunid && dom.inputCollectRunid.value);
    var now = Date.now();
    if (!force && now - (state.collection.lastActivePreviewAt || 0) < 1800) return;
    state.collection.lastActivePreviewAt = now;
    if (!name) {
      if (dataWorkspace && dataWorkspace.syncActiveCsvFallback) {
        dataWorkspace.syncActiveCsvFallback(function () {});
      }
      return;
    }
    if (state.csvPreview.selectedFile !== name) {
      state.csvPreview.selectedFile = name;
    }
    previewCSVFile(name);
  }

  function renderCSVPreviewTable(data) {
    if (dataWorkspace) dataWorkspace.renderCSVPreviewTable(data);
  }

  function downloadCSVFile(name) {
    if (dataWorkspace) dataWorkspace.downloadCSVFile(name);
  }

  function loadDataSummary() {
    if (dataWorkspace) dataWorkspace.loadDataSummary();
  }

  function startDatasetBuild() {
    if (dataWorkspace) dataWorkspace.startDatasetBuild();
  }

  function refreshDatasets() {
    if (dataWorkspace) dataWorkspace.refreshDatasets();
  }

  function renderDatasetBuilder() {
    if (dataWorkspace) dataWorkspace.renderDatasetBuilder();
  }

  function renderDatasetBuildHistory() {
    if (dataWorkspace && dataWorkspace.renderDatasetBuildHistory) dataWorkspace.renderDatasetBuildHistory();
  }

  function loadExpCSVFiles() {
    if (dataWorkspace) dataWorkspace.loadExperimentCsvFiles();
  }

  function renderExperimentHistory() {
    if (!dom.expHistoryBody) return;
    var rows = state.experiment.recent || [];
    if (!rows.length) {
      dom.expHistoryBody.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary);text-align:center;padding:20px;">' + t('noData') + '</td></tr>';
      return;
    }
    dom.expHistoryBody.innerHTML = rows.map(function (row) {
      var started = row.startedAt ? new Date(row.startedAt).toLocaleString() : '--';
      return '<tr>' +
        '<td title="' + escHtml(row.runId || '') + '">' + escHtml(row.runId || '(auto)') + '</td>' +
        '<td>' + escHtml(row.faultType || 'normal') + '</td>' +
        '<td>' + escHtml(row.status || '--') + '</td>' +
        '<td>' + escHtml(String(row.rowsCollected == null ? 0 : row.rowsCollected)) + '</td>' +
        '<td title="' + escHtml(started) + '">' + escHtml(started) + '</td>' +
      '</tr>';
    }).join('');
  }

  // ── Theme / Lang ──────────────────────────────────
  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    saveStored('theme', theme);
    dbSetSetting('theme', theme);
    if (dom.selectTheme) dom.selectTheme.value = theme;

    if (dom.btnTheme) {
      dom.btnTheme.innerHTML = theme === 'dark' ? sunIcon() : moonIcon();
    }

    setTimeout(function () {
      resizeAllCharts();
      drawDpad();
      if (state.csvPreview.preview) renderCSVPreviewTable(state.csvPreview.preview);
    }, 100);
  }

  function toggleTheme() {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
  }

  function backgroundImageCss(pathValue) {
    var raw = String(pathValue || '').trim();
    if (!raw) return 'none';
    if (/^(https?:|file:|data:)/i.test(raw)) {
      return 'url("' + raw.replace(/"/g, '\\"') + '")';
    }
    var normalized = raw.replace(/\\/g, '/');
    if (/^[a-z]:\//i.test(normalized)) normalized = '/' + normalized;
    return 'url("file://' + encodeURI(normalized).replace(/"/g, '%22') + '")';
  }

  function fontFamilyCss(value) {
    if (value === 'microsoft') return '"Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif';
    if (value === 'mono') return '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace';
    if (value === 'serif') return '"Times New Roman", "Noto Serif SC", SimSun, serif';
    return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  }

  function applyAppearance() {
    var a = state.appearance;
    var root = document.documentElement;
    var fontSize = Math.max(11, Math.min(18, Number(a.fontSize) || 13));
    var bgOpacity = Math.max(0, Math.min(70, Number(a.bgOpacity) || 0));
    var bgBlur = Math.max(0, Math.min(12, Number(a.bgBlur) || 0));

    root.style.setProperty('--font-ui', fontFamilyCss(a.fontFamily));
    root.style.setProperty('--base-font-size', fontSize + 'px');
    root.style.setProperty('--app-bg-image', backgroundImageCss(a.bgImage));
    root.style.setProperty('--app-bg-opacity', String(bgOpacity / 100));
    root.style.setProperty('--app-bg-blur', bgBlur + 'px');

    if (dom.selectFontFamily) dom.selectFontFamily.value = a.fontFamily;
    if (dom.inputFontSize) dom.inputFontSize.value = fontSize;
    if (dom.fontSizeValue) dom.fontSizeValue.textContent = fontSize + 'px';
    if (dom.inputBgImage) dom.inputBgImage.value = a.bgImage;
    if (dom.inputBgOpacity) dom.inputBgOpacity.value = bgOpacity;
    if (dom.bgOpacityValue) dom.bgOpacityValue.textContent = bgOpacity + '%';
    if (dom.inputBgBlur) dom.inputBgBlur.value = bgBlur;
    if (dom.bgBlurValue) dom.bgBlurValue.textContent = bgBlur + 'px';

    saveStored('appearanceFontFamily', a.fontFamily);
    saveStored('appearanceFontSize', String(fontSize));
    saveStored('appearanceBgImage', a.bgImage);
    saveStored('appearanceBgOpacity', String(bgOpacity));
    saveStored('appearanceBgBlur', String(bgBlur));
    dbSetSetting('appearance', {
      fontFamily: a.fontFamily,
      fontSize: fontSize,
      bgImage: a.bgImage,
      bgOpacity: bgOpacity,
      bgBlur: bgBlur,
    });
    resizeAllCharts();
    drawDpad();
  }

  function resetAppearance() {
    state.appearance = {
      fontFamily: 'system',
      fontSize: 13,
      bgImage: '',
      bgOpacity: 0,
      bgBlur: 0,
    };
    applyAppearance();
  }

  function setLang(lang) {
    state.lang = lang;
    saveStored('lang', lang);
    dbSetSetting('lang', lang);
    if (dom.selectLang) dom.selectLang.value = lang;
    if (dom.btnLang) dom.btnLang.textContent = lang === 'zh' ? 'EN' : '中';
    i18nAll();
    if (dom.advancedToggle) {
      dom.advancedToggle.textContent = (state.collection.showAdvanced ? '▾ ' : '▸ ') + t('advanced');
    }
    updateInferenceDom();
    updateConnectionUI(state.connection.status || 'offline');
    updateTelemetryDom();
    updateHeadingStatusUI();
    updateModelConvertDom();
    if (dataWorkspace && dataWorkspace.refreshLocaleText) dataWorkspace.refreshLocaleText();
    renderDatasetBuilder();
    renderCSVPreviewTable(state.csvPreview.preview);
    resizeAllCharts();
  }

  function toggleLang() {
    setLang(state.lang === 'zh' ? 'en' : 'zh');
  }

  function sunIcon() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  }

  function moonIcon() {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }

  // ── Window controls ───────────────────────────────
  function initWindowControls() {
    var api = window.electronAPI;
    if (!api) return;

    if (dom.btnMinimize) dom.btnMinimize.addEventListener('click', function () { api.minimize(); });
    if (dom.btnMaximize) dom.btnMaximize.addEventListener('click', function () { api.maximize(); });
    if (dom.btnClose) dom.btnClose.addEventListener('click', function () { api.close(); });

    api.isMaximized().then(function (maxed) {
      updateMaximizeIcon(maxed);
    }).catch(function (e) { console.warn('DB error:', e.message); });

    api.onMaximizeChange(function (maxed) {
      updateMaximizeIcon(maxed);
    });
  }

  function updateMaximizeIcon(maxed) {
    if (!dom.btnMaximize) return;
    if (maxed) {
      dom.btnMaximize.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="7" height="7" rx="0.5" fill="none" stroke="currentColor"/><rect x="2.5" y="0.5" width="7" height="7" rx="0.5" fill="var(--titlebar-bg)" stroke="currentColor"/></svg>';
    } else {
      dom.btnMaximize.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" rx="0.5" fill="none" stroke="currentColor"/></svg>';
    }
  }

  // ── Event handlers ────────────────────────────────
  function bindEvents() {
    // Connect
    dom.btnConnect.addEventListener('click', connect);
    dom.btnDisconnect.addEventListener('click', disconnect);
    dom.inputIp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') connect();
    });

    // IMU topic
    dom.selectImu.addEventListener('change', function () {
      switchImuTopic(this.value);
    });

    // Activity bar
    if (dom.activitybar) {
      dom.activitybar.addEventListener('click', function (e) {
        var btn = e.target.closest('.activity-btn');
        if (!btn || !dom.activitybar.contains(btn)) return;
        switchActivity(btn.dataset.view);
      });
    }
    dom.activityBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchActivity(this.dataset.view);
      });
    });

    // Theme
    dom.btnTheme.addEventListener('click', toggleTheme);
    dom.selectTheme.addEventListener('change', function () {
      setTheme(this.value);
    });

    // Language
    dom.btnLang.addEventListener('click', toggleLang);
    dom.selectLang.addEventListener('change', function () {
      setLang(this.value);
    });

    if (dom.statusbarFaultEnableBtn) dom.statusbarFaultEnableBtn.addEventListener('click', toggleFaultAlarmEnabled);
    if (dom.statusbarFaultResetBtn) dom.statusbarFaultResetBtn.addEventListener('click', resetFaultAlarmManual);

    if (dom.selectFontFamily) {
      dom.selectFontFamily.addEventListener('change', function () {
        state.appearance.fontFamily = this.value;
        applyAppearance();
      });
    }
    if (dom.inputFontSize) {
      dom.inputFontSize.addEventListener('input', function () {
        state.appearance.fontSize = Number(this.value) || 13;
        applyAppearance();
      });
    }
    if (dom.inputBgImage) {
      dom.inputBgImage.addEventListener('change', function () {
        state.appearance.bgImage = this.value.trim();
        applyAppearance();
      });
      dom.inputBgImage.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          state.appearance.bgImage = this.value.trim();
          applyAppearance();
        }
      });
    }
    if (dom.inputBgOpacity) {
      dom.inputBgOpacity.addEventListener('input', function () {
        state.appearance.bgOpacity = Number(this.value) || 0;
        applyAppearance();
      });
    }
    if (dom.inputBgBlur) {
      dom.inputBgBlur.addEventListener('input', function () {
        state.appearance.bgBlur = Number(this.value) || 0;
        applyAppearance();
      });
    }
    if (dom.btnAppearanceReset) {
      dom.btnAppearanceReset.addEventListener('click', resetAppearance);
    }
    if (dom.inputInferenceManifest) {
      dom.inputInferenceManifest.addEventListener('change', function () {
        state.inference.manifestPath = this.value.trim();
        saveStored('inferenceManifestPath', state.inference.manifestPath);
      });
      dom.inputInferenceManifest.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') loadInferenceModel(this.value.trim());
      });
    }
    if (dom.btnInferenceReload) {
      dom.btnInferenceReload.addEventListener('click', function () {
        loadInferenceModel(dom.inputInferenceManifest ? dom.inputInferenceManifest.value.trim() : '');
      });
    }
    [
      [dom.inputModelRoot, 'modelRoot', 'modelConverterModelRoot'],
      [dom.inputSelectedModelDir, 'selectedDir', 'modelConverterSelectedDir'],
      [dom.inputModelOutputDir, 'outputDir', 'modelConverterOutputDir'],
      [dom.inputPythonRuntime, 'pythonPath', 'modelConverterPythonPath'],
    ].forEach(function (item) {
      var el = item[0];
      if (!el) return;
      el.addEventListener('change', function () {
        state.modelConverter[item[1]] = this.value.trim();
        saveStored(item[2], state.modelConverter[item[1]]);
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') convertModelFromSettings();
      });
    });
    if (dom.btnModelConvert) {
      dom.btnModelConvert.addEventListener('click', convertModelFromSettings);
    }
    if (dom.btnInferenceStatus) {
      dom.btnInferenceStatus.addEventListener('click', function () {
        refreshInferenceStatus();
        refreshModelConverterStatus();
      });
    }

    // Connection history clicks
    dom.connectionHistory.addEventListener('click', function (e) {
      var item = e.target.closest('.history-item');
      if (item && item.dataset.ip) {
        dom.inputIp.value = item.dataset.ip;
        if (state.activeActivity !== 'dashboard') {
          switchActivity('dashboard');
        }
      }
    });

    // Chart time range buttons
    document.querySelectorAll('.btn-time').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.btn-time').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        setChartTimeRange(parseInt(this.dataset.seconds));
        resizeAllCharts();
      });
    });

    // Chart visibility checkboxes
    document.querySelectorAll('#sidebar-charts .sidebar-check input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var chartName = this.dataset.chart;
        if (state.charts[chartName]) {
          state.charts[chartName].setVisible(this.checked);
        }
        // Show/hide the corresponding card in full charts view
        var cardMap = { speed: 'chart-speed', current: 'chart-current', imu: 'chart-imu', heading: 'chart-heading-card' };
        var cardTarget = $(cardMap[chartName]);
        if (cardTarget) {
          var card = cardTarget.classList.contains('chart-card-full') ? cardTarget : cardTarget.closest('.chart-card-full');
          if (card) card.style.display = this.checked ? '' : 'none';
        }
      });
    });

    // ── Drive controls ──
    if (dom.inputStrafe) {
      dom.inputStrafe.addEventListener('input', function () {
        state.drive.lateral = parseInt(this.value) / 100;
      });
    }

    if (dom.selectSpeedMult) {
      dom.selectSpeedMult.addEventListener('change', function () {
        state.drive.mult = parseFloat(this.value);
      });
    }

    if (dom.btnStop) dom.btnStop.addEventListener('click', stopManualDrive);
    if (dom.btnEstop) dom.btnEstop.addEventListener('click', toggleEstop);

    // ── Cruise controls ──
    if (dom.cruiseDirGrid) {
      dom.cruiseDirGrid.addEventListener('click', function (e) {
        var btn = e.target.closest('.cruise-dir-btn');
        if (!btn) return;
        var dx = parseInt(btn.dataset.dx);
        var dy = parseInt(btn.dataset.dy);
        setCruiseDirection(dx, dy);
      });
    }
    if (dom.btnCruiseStart) dom.btnCruiseStart.addEventListener('click', startCruise);
    if (dom.btnCruiseStop) dom.btnCruiseStop.addEventListener('click', stopCruise);

    // ── Heading controls ──
    if (dom.btnHeadingSend) dom.btnHeadingSend.addEventListener('click', sendHeadingAngle);
    if (dom.btnHeadingZero) dom.btnHeadingZero.addEventListener('click', resetHeadingZero);
    if (dom.inputHeadingAngle) {
      dom.inputHeadingAngle.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') sendHeadingAngle();
      });
    }

    // ── Collection controls ──
    if (dom.btnCollectStart) dom.btnCollectStart.addEventListener('click', startCollection);
    if (dom.btnCollectStop) dom.btnCollectStop.addEventListener('click', stopCollection);
    if (dom.btnCurrentReconnect) dom.btnCurrentReconnect.addEventListener('click', reconnectCurrentReader);
    if (dom.inputCurrentPort) {
      dom.inputCurrentPort.addEventListener('input', function () {
        state.collection.currentPort = this.value || state.collection.currentPort;
      });
    }
    if (dom.advancedToggle) dom.advancedToggle.addEventListener('click', toggleAdvanced);

    // CSV table actions
    if (dom.csvTableBody && !dom.csvTableBody.dataset.csvActionBound) {
      dom.csvTableBody.dataset.csvActionBound = '1';
      dom.csvTableBody.addEventListener('click', function (e) {
        var btn = e.target.closest('.csv-action-btn');
        if (!btn) return;
        var action = btn.dataset.action;
        var file = btn.dataset.file;
        if (action === 'preview') previewCSVFile(file);
        if (action === 'download') downloadCSVFile(file);
      });
    }
    if (dom.btnCsvRefresh && !dom.btnCsvRefresh.dataset.csvRefreshBound) {
      dom.btnCsvRefresh.dataset.csvRefreshBound = '1';
      dom.btnCsvRefresh.addEventListener('click', loadCSVFiles);
    }
    if (dom.selectCsvPreviewRows && !dom.selectCsvPreviewRows.dataset.csvRowsBound) {
      dom.selectCsvPreviewRows.dataset.csvRowsBound = '1';
      dom.selectCsvPreviewRows.addEventListener('change', function () {
        state.csvPreview.rowLimit = Number(this.value) || 100;
        if (state.csvPreview.selectedFile) previewCSVFile(state.csvPreview.selectedFile);
      });
    }
    if (dom.inputCsvColumnFilter) {
      dom.inputCsvColumnFilter.addEventListener('input', function () {
        state.csvPreview.columnFilter = this.value;
        renderCSVPreviewTable(state.csvPreview.preview);
      });
    }
    if (dom.btnSummaryRefresh) dom.btnSummaryRefresh.addEventListener('click', loadDataSummary);
    if (dom.btnDatasetBuild) dom.btnDatasetBuild.addEventListener('click', startDatasetBuild);
    if (dom.btnDatasetRefresh) dom.btnDatasetRefresh.addEventListener('click', refreshDatasets);

    // ── Experiment controls ──
    if (dom.btnExperimentStart) dom.btnExperimentStart.addEventListener('click', startExperiment);
    if (dom.btnExperimentReset) dom.btnExperimentReset.addEventListener('click', resetExperiment);
    if (dom.btnFaultApply) dom.btnFaultApply.addEventListener('click', applyFaultInjection);
    if (dom.btnFaultReset) dom.btnFaultReset.addEventListener('click', resetFaultInjection);
    if (dom.inputFaultEnable) dom.inputFaultEnable.addEventListener('change', updateFaultStatusUI);
    if (dom.inputExperimentFaultType) {
      dom.inputExperimentFaultType.addEventListener('change', updateExperimentSummary);
    }
    // Update experiment summary when any experiment field changes
    [
      'input-experiment-fault-type', 'exp-wheel-a', 'exp-wheel-b', 'exp-wheel-c',
      'input-experiment-runid', 'input-experiment-duration',
      'input-experiment-motion', 'input-experiment-rate', 'input-experiment-output',
    ].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('change', updateExperimentSummary);
      el.addEventListener('input', updateExperimentSummary);
    });
    [
      dom.expAlphaA,
      dom.expAlphaB,
      dom.expAlphaC,
    ].forEach(function (input) {
      if (!input) return;
      input.addEventListener('input', function () {
        updateExperimentSummary();
      });
      input.addEventListener('change', function () {
        input.value = alphaValue(input).toFixed(2);
        updateExperimentSummary();
      });
    });

    // Keyboard
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('gamepadconnected', updateGamepadUI);
    window.addEventListener('gamepaddisconnected', updateGamepadUI);

    // Collect all control buttons for connection-state gating
    controlButtons = [
      dom.btnEstop, dom.btnCruiseStart, dom.btnCruiseStop,
      dom.btnHeadingSend, dom.btnHeadingZero,
      dom.btnCollectStart, dom.btnCollectStop, dom.btnCurrentReconnect,
      dom.btnExperimentStart, dom.btnFaultApply, dom.btnFaultReset,
      dom.btnDatasetBuild,
    ].filter(Boolean);

    // Window resize — debounced chart resize
    var resizeTimeout;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(function () {
        resizeAllCharts();
        drawDpad();
      }, 150);
    });
  }

  // ── Init ──────────────────────────────────────────
  function init() {
    // Apply saved state
    setTheme(state.theme);
    setLang(state.lang);
    applyAppearance();
    if (state.connection.ip) {
      dom.inputIp.value = state.connection.ip;
    }
    dom.selectImu.value = state.connection.imuTopic;
    dom.selectTheme.value = state.theme;
    dom.selectLang.value = state.lang;
    if (dom.inputCurrentPort) dom.inputCurrentPort.value = state.collection.currentPort;
    if (dom.advancedPanel) dom.advancedPanel.style.display = state.collection.showAdvanced ? '' : 'none';
    if (dom.advancedToggle) dom.advancedToggle.textContent = (state.collection.showAdvanced ? '▾ ' : '▸ ') + t('advanced');
    if (dom.inputDatasetInput) dom.inputDatasetInput.value = state.dataset.inputDir;
    if (dom.inputDatasetOutput) dom.inputDatasetOutput.value = state.dataset.outputDir;
    if (dom.selectDatasetFeature) dom.selectDatasetFeature.value = state.dataset.featureSet;
    if (dom.inputDatasetWindow) dom.inputDatasetWindow.value = state.dataset.windowSize;
    if (dom.inputDatasetStep) dom.inputDatasetStep.value = state.dataset.stepSize;
    if (dom.selectDatasetScaler) dom.selectDatasetScaler.value = state.dataset.scaler;
    if (dom.inputDatasetTrimStart) dom.inputDatasetTrimStart.value = state.dataset.trimStart;
    if (dom.inputDatasetTrimEnd) dom.inputDatasetTrimEnd.value = state.dataset.trimEnd;
    if (dom.inputDatasetSameRun) dom.inputDatasetSameRun.checked = state.dataset.allowSameRunSplit;
    if (dom.inputInferenceManifest) dom.inputInferenceManifest.value = state.inference.manifestPath;
    if (dom.inputModelRoot) dom.inputModelRoot.value = state.modelConverter.modelRoot;
    if (dom.inputSelectedModelDir) dom.inputSelectedModelDir.value = state.modelConverter.selectedDir;
    if (dom.inputModelOutputDir) dom.inputModelOutputDir.value = state.modelConverter.outputDir;
    if (dom.inputPythonRuntime) dom.inputPythonRuntime.value = state.modelConverter.pythonPath;

    // Init charts
    initCharts();

    // Init D-pad
    initDpad();

    // Bind events
    bindEvents();

    // Window controls
    initWindowControls();

    // Render initial state
    i18nAll();
    renderEventLog();
    renderConnectionHistory();
    refreshConnectionHistoryFromDb();
    updateConnectionUI('offline');
    refreshInferenceStatus();
    refreshModelConverterStatus();
    updateModelConvertDom();
    renderDatasetBuilder();
    switchActivity('dashboard');

    // Initial chart resize
    setTimeout(resizeAllCharts, 200);

    addLog('YP Console ready', '');
    window.__wheeltecReady = true;
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
