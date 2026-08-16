(function () {
  'use strict';

  var root = window.WheelTecModules = window.WheelTecModules || {};

  function createDataWorkspace(ctx) {
    var state = ctx.state;
    var dom = ctx.dom;
    var apiGet = ctx.apiGet;
    var apiUrl = ctx.apiUrl;
    var dbApi = ctx.dbApi;
    var addLog = ctx.addLog;
    var t = ctx.t;
    var escHtml = ctx.escHtml;

    function splitPath(path) {
      var s = String(path || '');
      if (!s) return { dir: '', name: '' };
      var idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
      if (idx < 0) return { dir: '', name: s };
      return { dir: s.substring(0, idx), name: s.substring(idx + 1) };
    }

    function activeCsvInfo() {
      var status = state.collection.status || {};
      var fromPath = splitPath(status.filepath || status.file || '');
      var outputDir = status.output_dir || status.outputDir || '';
      var name = fromPath.name || status.filename || '';
      return {
        dir: fromPath.dir || (name ? outputDir : ''),
        name: name,
        path: status.filepath || status.file || '',
        outputDir: outputDir,
      };
    }

    function collectionStatusActive() {
      var status = state.collection.status || {};
      return !!(status.collecting || status.starting ||
        status.state === 'collecting' || status.state === 'running' ||
        status.state === 'starting' || status.state === 'stopping');
    }

    function collectDir() {
      var active = activeCsvInfo();
      return (active.name && active.dir) ||
        (collectionStatusActive() && active.outputDir) ||
        (dom.inputCollectOutput && dom.inputCollectOutput.value) ||
        active.outputDir ||
        state.collection.outputDir;
    }

    function dirForFile(name) {
      var active = activeCsvInfo();
      if (active.name && active.name === name && active.dir) return active.dir;
      return collectDir();
    }

    function pathForFile(name) {
      var active = activeCsvInfo();
      if (active.path && active.name && active.name === name) return active.path;
      return '';
    }

    function syncActualCollectDirToUi() {
      var active = activeCsvInfo();
      var dir = active.dir || (collectionStatusActive() ? active.outputDir : '');
      if (!dir) return;
      state.collection.activeCsvDir = dir;
      state.collection.activeCsvName = active.name;
      if (dom.inputCollectOutput && document.activeElement !== dom.inputCollectOutput) {
        dom.inputCollectOutput.value = dir;
      }
    }

    function setCsvRefreshState(text, loading, textKey) {
      state.collection.csvRefreshSourceKey = textKey || '';
      state.collection.csvRefreshSource = text || '';
      if (dom.btnCsvRefresh) {
        dom.btnCsvRefresh.disabled = !!loading;
        dom.btnCsvRefresh.textContent = loading ? t('loading') : t('csvRefresh');
      }
      if (dom.csvPreviewInfo && text && !state.csvPreview.selectedFile) {
        dom.csvPreviewInfo.textContent = text;
      }
      updateCsvHttpDebugView();
    }

    function logCsv(text, cls, minIntervalMs) {
      if (!text) return;
      var now = Date.now();
      var key = text + '|' + (cls || '');
      var minMs = minIntervalMs == null ? 1200 : minIntervalMs;
      if (state.collection._lastCsvLogKey === key && now - (state.collection._lastCsvLogAt || 0) < minMs) return;
      state.collection._lastCsvLogKey = key;
      state.collection._lastCsvLogAt = now;
      var entry = { text: text, cls: cls || 'event-subscribed', time: new Date().toLocaleTimeString() };
      state.collection.csvHttpLogs = state.collection.csvHttpLogs || [];
      state.collection.csvHttpLogs.unshift(entry);
      if (state.collection.csvHttpLogs.length > 8) state.collection.csvHttpLogs.length = 8;
      renderCsvHttpLogView();
      if (addLog) addLog('CSV: ' + text, cls || 'event-subscribed');
    }

    function csvLogClass(cls) {
      if (cls === 'event-error') return 'error';
      if (cls === 'event-connected') return 'ok';
      return 'loading';
    }

    function renderCsvHttpLogView() {
      if (!dom.csvHttpLog) return;
      var logs = state.collection.csvHttpLogs || [];
      if (!logs.length) {
        dom.csvHttpLog.innerHTML = '<div class="csv-http-log-entry">' + escHtml(t('csvLogWaiting')) + '</div>';
        return;
      }
      dom.csvHttpLog.innerHTML = logs.map(function (item) {
        return '<div class="csv-http-log-entry ' + csvLogClass(item.cls) + '" title="' + escHtml(item.time + ' ' + item.text) + '">' +
          '<span class="event-time">' + escHtml(item.time) + '</span>' + escHtml(item.text) +
        '</div>';
      }).join('');
    }

    function setCsvHttpDebug(label, detail) {
      state.collection.csvHttpDebug = {
        label: label || '',
        detail: detail || '',
        at: new Date().toLocaleTimeString(),
      };
      updateCsvHttpDebugView();
    }

    function formatParams(params) {
      params = params || {};
      return Object.keys(params).map(function (key) {
        return key + '=' + String(params[key]);
      }).join(' | ');
    }

    function csvHttpDebugText() {
      var debug = state.collection.csvHttpDebug || {};
      if (debug.label || debug.detail) {
        return '[' + (debug.at || '--') + '] ' + (debug.label || '') + (debug.detail ? ' | ' + debug.detail : '');
      }
      return t('csvHttpWaiting');
    }

    function updateCsvHttpDebugView() {
      if (!dom.csvHttpDebug) return;
      var sourceText = state.collection.csvRefreshSourceKey ? t(state.collection.csvRefreshSourceKey) : (state.collection.csvRefreshSource || '');
      var active = activeCsvInfo();
      if (active.dir && active.name) {
        sourceText += (sourceText ? ' | ' : '') + t('csvActiveFile') + ': ' + active.name + ' @ ' + active.dir;
      }
      dom.csvHttpDebug.textContent = (sourceText ? sourceText + ' | ' : '') + csvHttpDebugText();
      dom.csvHttpDebug.title = dom.csvHttpDebug.textContent;
    }

    function isOnline() {
      return !!state.connection.ip;
    }

    function normalizeApiFile(row) {
      row = row || {};
      var rowCount = row.row_count == null ? row.rows : row.row_count;
      return {
        name: row.name || '',
        size: Number(row.size || row.size_bytes || 0),
        mtime: row.mtime == null ? null : Number(row.mtime),
        row_count: rowCount == null ? null : Number(rowCount),
        column_count: row.column_count,
        sync_status: row.sync_status || 'http',
        last_synced_row_count: row.last_synced_row_count == null ?
          (rowCount == null ? null : Number(rowCount)) :
          Number(row.last_synced_row_count),
        last_synced_at: row.last_synced_at || '',
        last_error: row.last_error || '',
        duration_sec: row.duration_sec || 0,
        source: row.source || 'robot HTTP',
      };
    }

    function mergeFileByName(files, file) {
      if (!file || !file.name) return files || [];
      var out = (files || []).slice();
      var found = false;
      out = out.map(function (item) {
        if (item.name === file.name) {
          found = true;
          return Object.assign({}, item, file);
        }
        return item;
      });
      if (!found) out.unshift(file);
      return out;
    }

    function loadCsvPreviewFromHttp(directory, name, maxPoints, done, filepath) {
      if (!isOnline() || (!name && !filepath)) {
        if (done) done(!state.connection.ip ? 'robot IP missing' : 'CSV path unavailable');
        return;
      }
      var params = { max_points: maxPoints || 500 };
      if (filepath) {
        params.path = filepath;
      } else {
        params.dir = directory;
        params.name = name;
      }
      setCsvHttpDebug('GET /api/data/preview', formatParams(params));
      logCsv('GET /api/data/preview ' + formatParams(params), 'event-subscribed');
      apiGet('/api/data/preview', params, function (err, data) {
        if (err) {
          setCsvHttpDebug('GET /api/data/preview failed', err + ' | ' + formatParams(params));
          logCsv('preview failed; ' + err, 'event-error');
          if (done) done(err);
          return;
        }
        setCsvHttpDebug('GET /api/data/preview ok', formatParams(params));
        logCsv('preview ok; rows=' + ((data && data.row_count) || 0), 'event-connected');
        if (done) done(null, data);
      });
    }

    function fileFromPreview(data, source) {
      data = data || {};
      return {
        name: data.name || '',
        size: Number(data.size || 0),
        mtime: data.mtime == null ? null : Number(data.mtime),
        row_count: data.row_count || 0,
        column_count: data.columns ? data.columns.length : 0,
        sync_status: data.row_count === (data.rows || []).length ? 'complete' : 'partial',
        last_synced_row_count: (data.rows || []).length,
        last_synced_at: new Date().toISOString(),
        last_error: '',
        duration_sec: data.duration_sec || 0,
        source: source || 'active status',
      };
    }

    function currentCsvCandidates() {
      var status = state.collection.status || {};
      var active = activeCsvInfo();
      var items = [];
      function addItem(item) {
        var key = (item.path || '') + '|' + (item.name || '');
        if (!item.name && !item.path) return;
        if (items.some(function (existing) {
          return ((existing.path || '') + '|' + (existing.name || '')) === key;
        })) return;
        items.push(item);
      }
      function addName(name) {
        name = String(name || '').trim();
        if (!name || name.indexOf('/') !== -1 || name.indexOf('\\') !== -1) return;
        if (!/\.csv$/i.test(name)) name += '.csv';
        addItem({ name: name, path: '' });
      }
      if (active.path) addItem({ name: active.name, path: active.path });
      else addName(active.name);
      addName(status.filename);
      addName(status.run_id);
      if (dom.inputCollectRunid) addName(dom.inputCollectRunid.value);
      return items;
    }

    function syncActiveCsvFallback(done) {
      var active = activeCsvInfo();
      var dir = active.dir || collectDir();
      var candidates = currentCsvCandidates();
      if (!dir || !candidates.length) {
        logCsv('active fallback skipped; path unavailable', 'event-error');
        if (done) done('active CSV path unavailable');
        return;
      }
      var index = 0;
      function tryNext(lastErr) {
        if (index >= candidates.length) {
          logCsv('active fallback exhausted; ' + (lastErr || 'preview failed'), 'event-error');
          if (done) done(lastErr || 'active CSV preview failed');
          return;
        }
        var candidate = candidates[index++];
        logCsv('active fallback try ' + (candidate.path || (dir + '/' + candidate.name)), 'event-subscribed');
        loadCsvPreviewFromHttp(dir, candidate.name, Math.max(state.csvPreview.rowLimit || 100, 500), function (err, data) {
          if (err) {
            tryNext(err);
            return;
          }
          var file = fileFromPreview(data, 'active status fallback');
          state.collection.files = mergeFileByName(state.collection.files, file);
          state.collection.fileError = '';
          state.csvPreview.selectedFile = state.csvPreview.selectedFile || file.name || candidate.name;
          renderCSVTable();
          renderSummaryFromFiles(state.collection.files);
          renderCSVPreviewTable(data);
          logCsv('active fallback loaded ' + (file.name || candidate.name || 'current CSV'), 'event-connected');
          if (done) done(null, file);
        }, candidate.path);
      }
      tryNext('');
    }

    function dbStartDatasetBuildRecord(cfg) {
      var db = dbApi();
      if (!db) return;
      db.startDatasetBuild({
        robotIp: state.connection.ip,
        inputDir: cfg.input_dir,
        outputDir: cfg.output_dir,
        featureSet: cfg.feature_set,
        windowSize: cfg.window_size,
        stepSize: cfg.step_size,
        scaler: cfg.scaler,
        status: 'starting',
        config: cfg,
      }).then(function (row) {
        state.dataset.localBuildId = row && row.id ? row.id : null;
        refreshDatasetBuildHistory();
      }).catch(function () {});
    }

    function dbUpdateDatasetBuildRecord(fields) {
      var db = dbApi();
      if (!db || !state.dataset.localBuildId) return;
      db.updateDatasetBuild(state.dataset.localBuildId, fields).then(refreshDatasetBuildHistory).catch(function () {});
    }

    function dbFinishDatasetBuildRecord(payload) {
      var db = dbApi();
      if (!db || !state.dataset.localBuildId) return;
      db.finishDatasetBuild(state.dataset.localBuildId, payload).then(function () {
        state.dataset.localBuildId = null;
        refreshDatasetBuildHistory();
      }).catch(function () {});
    }

    function refreshDatasetBuildHistory() {
      var db = dbApi();
      if (!db || !dom.datasetBuildHistoryBody) return;
      db.listDatasetBuilds(12).then(function (rows) {
        state.dataset.recentBuilds = rows || [];
        renderDatasetBuildHistory();
      }).catch(function () {});
    }

    function loadCSVFiles() {
      syncActualCollectDirToUi();
      var dir = collectDir();
      setCsvRefreshState(t('csvLoadingHttp'), true, 'csvLoadingHttp');
      setCsvHttpDebug('CSV loading', 'dir=' + (dir || '--'));
      logCsv('loading over HTTP; dir=' + (dir || '--'), 'event-subscribed', 0);
      if (!dir) {
        state.collection.files = [];
        state.collection.fileError = 'CSV directory is empty';
        setCsvHttpDebug('CSV refresh skipped', state.collection.fileError);
        logCsv('skipped; directory is empty', 'event-error');
        setCsvRefreshState(state.collection.fileError, false);
        renderCSVTable();
        renderSummaryData({ file_count: 0, total_rows: 0, total_duration_sec: 0 });
        return;
      }
      if (!isOnline()) {
        state.collection.files = [];
        state.collection.fileError = 'Robot IP missing; connect or enter robot IP to load CSV';
        setCsvHttpDebug('CSV refresh skipped', state.collection.fileError);
        logCsv('skipped; robot IP missing', 'event-error');
        setCsvRefreshState(state.collection.fileError, false);
        renderCSVTable();
        renderSummaryData({ file_count: 0, total_rows: 0, total_duration_sec: 0 });
        return;
      }
      setCsvHttpDebug('GET /api/data/list', 'dir=' + dir);
      logCsv('GET /api/data/list dir=' + dir, 'event-subscribed');
      apiGet('/api/data/list', { dir: dir }, function (err, data) {
        if (err) {
          setCsvHttpDebug('GET /api/data/list failed', err + ' | dir=' + dir);
          logCsv('list failed; ' + err, 'event-error');
          syncActiveCsvFallback(function (fallbackErr) {
            if (!fallbackErr) {
              setCsvRefreshState(t('csvSourceRobotHttpActive'), false, 'csvSourceRobotHttpActive');
              logCsv('active file fallback ok', 'event-connected');
              loadDataSummary();
              return;
            }
            state.collection.files = [];
            state.collection.fileError = 'Robot CSV list failed: ' + err + '; active CSV failed: ' + fallbackErr;
            logCsv('active file fallback failed; ' + fallbackErr, 'event-error');
            setCsvRefreshState(state.collection.fileError, false);
            renderCSVTable();
            renderSummaryData({ file_count: 0, total_rows: 0, total_duration_sec: 0 });
          });
          return;
        }
        var robotFiles = ((data && data.files) || []).map(normalizeApiFile).filter(function (file) {
          return !!file.name;
        });
        setCsvHttpDebug('GET /api/data/list ok', 'dir=' + ((data && data.dir) || dir) + ' | files=' + robotFiles.length + ((data && data.error) ? ' | error=' + data.error : ''));
        logCsv('list ok; files=' + robotFiles.length + '; dir=' + ((data && data.dir) || dir), robotFiles.length ? 'event-connected' : 'event-subscribed');
        if (robotFiles.length) {
          state.collection.files = robotFiles;
          state.collection.fileError = '';
          setCsvRefreshState(t('csvSourceRobotHttp'), false, 'csvSourceRobotHttp');
          renderCSVTable();
          renderSummaryFromFiles(robotFiles);
          loadDataSummary();
          return;
        }
        if (currentCsvCandidates().length) {
          syncActiveCsvFallback(function (fallbackErr) {
            if (fallbackErr) {
              state.collection.files = [];
              state.collection.fileError = (data && data.error)
                ? data.error + (data.dir ? ': ' + data.dir : '')
                : 'Active CSV preview failed: ' + fallbackErr;
              logCsv('list empty and active fallback failed; ' + fallbackErr, 'event-error');
              setCsvRefreshState(state.collection.fileError, false);
              renderCSVTable();
              renderSummaryData({ file_count: 0, total_rows: 0, total_duration_sec: 0 });
            } else {
              setCsvRefreshState(t('csvSourceRobotHttpActive'), false, 'csvSourceRobotHttpActive');
              logCsv('list empty; active file fallback ok', 'event-connected');
              loadDataSummary();
            }
          });
          return;
        }
        state.collection.files = [];
        state.collection.fileError = data && data.error
          ? data.error + (data.dir ? ': ' + data.dir : '')
          : '';
        logCsv(state.collection.fileError ? ('list returned error; ' + state.collection.fileError) : 'list empty; no CSV files found', state.collection.fileError ? 'event-error' : 'event-subscribed');
        setCsvRefreshState(state.collection.fileError || t('csvSourceRobotHttp'), false, state.collection.fileError ? '' : 'csvSourceRobotHttp');
        renderCSVTable();
        renderSummaryData({ file_count: 0, total_rows: 0, total_duration_sec: 0 });
        if (!state.collection.fileError) {
          loadDataSummary();
        }
      });
    }

    function renderCSVTable() {
      if (!dom.csvTableBody) return;
      var files = state.collection.files;
      updateCsvHttpDebugView();
      if (files.length === 0) {
        dom.csvTableBody.innerHTML = '<tr><td colspan="4" style="color:var(--text-secondary);text-align:center;padding:20px;">' +
          (state.collection.fileError || t('noData')) + '</td></tr>';
        return;
      }
      dom.csvTableBody.innerHTML = files.map(function (f) {
        var mtime = f.mtime ? new Date(f.mtime * 1000).toLocaleString() : '--';
        var sync = f.sync_status ? ' · ' + f.sync_status : '';
        var rowCount = f.last_synced_row_count != null ? f.last_synced_row_count : f.row_count;
        var rows = rowCount == null ? 'rows --' : (rowCount + ' rows');
        var source = f.source ? ' · ' + f.source : '';
        return '<tr>' +
          '<td title="' + escHtml(f.name || '') + '">' + escHtml(truncateName(f.name, 28)) +
            '<br><small style="color:var(--text-secondary);">' + escHtml(rows + sync + source) + '</small></td>' +
          '<td>' + formatSize(f.size || 0) + '</td>' +
          '<td title="' + escHtml(mtime) + '">' + mtime + '</td>' +
          '<td>' +
            '<button class="csv-action-btn" data-action="preview" data-file="' + escHtml(f.name || '') + '">' + t('csvPreview') + '</button>' +
            '<button class="csv-action-btn" data-action="download" data-file="' + escHtml(f.name || '') + '">' + t('csvDownload') + '</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    function truncateName(name, maxLen) {
      if (!name || name.length <= maxLen) return name || '';
      return name.substring(0, maxLen - 3) + '...';
    }

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function previewCSVFile(name) {
      if (!name) {
        logCsv('preview skipped; file name missing', 'event-error', 0);
        return;
      }
      var dir = dirForFile(name);
      var filepath = pathForFile(name);
      state.csvPreview.selectedFile = name;
      state.csvPreview.previewLoading = true;
      if (dom.csvPreviewInfo) dom.csvPreviewInfo.textContent = t('loading') + '...';
      logCsv('preview loading ' + name, 'event-subscribed');
      if (!isOnline()) {
        state.csvPreview.previewLoading = false;
        state.csvPreview.previewError = t('csvPreviewRobotIpMissing');
        setCsvHttpDebug('CSV preview skipped', state.csvPreview.previewError);
        logCsv('preview skipped; robot IP missing', 'event-error');
        renderCSVPreviewTable(null);
        return;
      }

      loadCsvPreviewFromHttp(dir, name, state.csvPreview.rowLimit || 100, function (err, data) {
        state.csvPreview.previewLoading = false;
        if (err) {
          state.csvPreview.previewError = 'Preview failed: ' + err;
          if (dom.csvPreviewInfo) dom.csvPreviewInfo.textContent = state.csvPreview.previewError;
          logCsv('preview failed for ' + name + '; ' + err, 'event-error');
          renderCSVPreviewTable(null);
          return;
        }
        state.csvPreview.preview = data;
        state.csvPreview.previewError = '';
        state.collection.files = mergeFileByName(state.collection.files, fileFromPreview(data, 'HTTP preview'));
        renderCSVTable();
        renderCSVPreviewTable(data);
        renderSummaryData({
          selected_name: data.name || name,
          file_count: 1,
          total_rows: data.row_count || (data.rows || []).length || 0,
          total_duration_sec: data.duration_sec || 0,
        });
        logCsv('preview loaded ' + name + '; rows=' + ((data && data.row_count) || 0), 'event-connected');
      }, filepath);
    }

    function previewColumns(data) {
      var columns = (data && data.columns) || [];
      var filter = String(state.csvPreview.columnFilter || '').trim().toLowerCase();
      if (!filter) return columns;
      return columns.filter(function (col) {
        return String(col).toLowerCase().indexOf(filter) !== -1;
      });
    }

    function formatCellValue(value) {
      if (value == null || value === '') return '';
      if (typeof value === 'number' && isFinite(value)) {
        var abs = Math.abs(value);
        if (abs !== 0 && (abs >= 10000 || abs < 0.001)) return value.toExponential(3);
        return String(Number(value.toFixed(6)));
      }
      return String(value);
    }

    function renderCSVPreviewTable(data) {
      if (!dom.csvPreviewHead || !dom.csvPreviewBody) return;
      if (!data || !data.columns || !data.rows) {
        if (dom.csvPreviewWrap) dom.csvPreviewWrap.classList.add('is-empty');
        dom.csvPreviewHead.innerHTML = '<tr><th>--</th></tr>';
        dom.csvPreviewBody.innerHTML = '<tr><td style="color:var(--text-secondary);text-align:center;">' +
          (state.csvPreview.previewError ? escHtml(state.csvPreview.previewError) : escHtml(t('csvPreviewNoSelection'))) +
          '</td></tr>';
        if (dom.csvPreviewInfo && !state.csvPreview.previewError) dom.csvPreviewInfo.textContent = t('csvPreviewNoSelectionShort');
        return;
      }

      var columns = previewColumns(data);
      var rows = (data.rows || []).slice(0, state.csvPreview.rowLimit);
      if (columns.length === 0) {
        if (dom.csvPreviewWrap) dom.csvPreviewWrap.classList.add('is-empty');
        dom.csvPreviewHead.innerHTML = '<tr><th>--</th></tr>';
        dom.csvPreviewBody.innerHTML = '<tr><td style="color:var(--text-secondary);text-align:center;">' + escHtml(t('csvPreviewNoMatchedColumns')) + '</td></tr>';
        return;
      }

      if (dom.csvPreviewWrap) dom.csvPreviewWrap.classList.toggle('is-empty', rows.length === 0);
      dom.csvPreviewHead.innerHTML = '<tr><th>#</th>' + columns.map(function (col) {
        return '<th title="' + escHtml(col) + '">' + escHtml(col) + '</th>';
      }).join('') + '</tr>';

      dom.csvPreviewBody.innerHTML = rows.length ? rows.map(function (row, idx) {
        var rowNumber = row.__row_number || (idx + 1);
        return '<tr><td>' + rowNumber + '</td>' + columns.map(function (col) {
          var text = formatCellValue(row[col]);
          var empty = text === '';
          return '<td class="' + (empty ? 'csv-empty' : '') + '" title="' + escHtml(text || '<empty>') + '">' + escHtml(empty ? '--' : text) + '</td>';
        }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + (columns.length + 1) + '" style="color:var(--text-secondary);text-align:center;">' + escHtml(t('csvPreviewWaitingRows')) + '</td></tr>';
      if (dom.csvPreviewWrap) {
        dom.csvPreviewWrap.scrollTop = 0;
        dom.csvPreviewWrap.scrollLeft = 0;
      }

      if (dom.csvPreviewInfo) {
        dom.csvPreviewInfo.textContent =
          data.name + ' | ' +
          rows.length + '/' + (data.row_count || rows.length) + ' rows' +
          (rows.length && rows[0].__row_number ? ' | #' + rows[0].__row_number + '-#' + rows[rows.length - 1].__row_number : '') + ' | ' +
          columns.length + '/' + data.columns.length + ' columns | ' +
          formatSize(data.size || 0) +
          (data.sync_status ? ' | ' + data.sync_status : '');
      }
    }

    function downloadCSVFile(name) {
      if (!name) {
        logCsv('download skipped; file name missing', 'event-error', 0);
        return;
      }
      var dir = dirForFile(name);
      if (!isOnline()) {
        logCsv('download failed; robot IP missing', 'event-error', 0);
        return;
      }
      logCsv('download loading ' + name, 'event-subscribed', 0);
      var url = apiUrl('/api/data/download/' + encodeURIComponent(name), { dir: dir });
      if (!url) return;
      fetch(url)
        .then(function (r) {
          if (!r.ok) {
            return r.text().then(function (text) {
              throw new Error(text || ('HTTP ' + r.status));
            });
          }
          return r.blob();
        })
        .then(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(a.href);
          logCsv('downloaded ' + name, 'event-connected', 0);
        })
        .catch(function (err) {
          logCsv('download failed; ' + err.message, 'event-error', 0);
        });
    }

    function loadDataSummary() {
      var dir = collectDir();
      if (!dir || !isOnline()) {
        logCsv('summary skipped; ' + (!dir ? 'directory empty' : 'robot IP missing'), 'event-error');
        renderSummaryData({ file_count: 0, total_rows: 0, total_duration_sec: 0 });
        return;
      }
      setCsvHttpDebug('GET /api/data/summary', 'dir=' + dir);
      logCsv('GET /api/data/summary dir=' + dir, 'event-subscribed');
      apiGet('/api/data/summary', { dir: dir }, function (err, data) {
        if (!err && data && !data.error) {
          setCsvHttpDebug('GET /api/data/summary ok', 'dir=' + ((data && data.dir) || dir) + ' | files=' + (data.file_count || 0) + ' | rows=' + (data.total_rows || 0));
          logCsv('summary ok; files=' + (data.file_count || 0) + '; rows=' + (data.total_rows || 0), 'event-connected');
          renderSummaryData(data);
          return;
        }
        setCsvHttpDebug('GET /api/data/summary failed', (err || (data && data.error) || 'unknown') + ' | dir=' + dir);
        logCsv('summary failed; ' + (err || (data && data.error) || 'unknown'), 'event-error');
        var active = activeCsvInfo();
        if (active.path) {
          loadCsvPreviewFromHttp(active.dir || dir, active.name, Math.max(state.csvPreview.rowLimit || 100, 500), function (previewErr, preview) {
            if (previewErr || !preview) {
              renderSummaryData({ file_count: 0, total_rows: 0, total_duration_sec: 0 });
              return;
            }
            renderSummaryData({
              file_count: 1,
              total_rows: preview.row_count || 0,
              total_duration_sec: preview.duration_sec || 0,
            });
            logCsv('summary fallback from active CSV; rows=' + (preview.row_count || 0), 'event-connected');
          }, active.path);
          return;
        }
        renderSummaryData({ file_count: 0, total_rows: 0, total_duration_sec: 0 });
      });
    }

    function renderSummaryData(data) {
      data = data || {};
      state.dataSummary = {
        selected_name: data.selected_name || '',
        file_count: Number(data.file_count || 0),
        total_rows: Number(data.total_rows || 0),
        total_duration_sec: Number(data.total_duration_sec || 0),
      };
      if (dom.summarySelected) {
        var selected = state.dataSummary.selected_name || (state.dataSummary.file_count ? 'all CSV files' : '--');
        dom.summarySelected.title = selected;
        if (selected && selected !== '--' && selected.length > 18) {
          dom.summarySelected.classList.add('metric-marquee');
          dom.summarySelected.innerHTML = '<span>' + escHtml(selected) + '</span>';
        } else {
          dom.summarySelected.classList.remove('metric-marquee');
          dom.summarySelected.textContent = selected;
        }
      }
      if (dom.summaryFiles) dom.summaryFiles.textContent = String(state.dataSummary.file_count);
      if (dom.summaryRows) dom.summaryRows.textContent = String(state.dataSummary.total_rows);
      if (dom.summaryTime) {
        dom.summaryTime.textContent = state.dataSummary.total_duration_sec
          ? formatDuration(state.dataSummary.total_duration_sec)
          : '--';
      }
    }

    function renderSummaryFromFiles(files) {
      files = files || [];
      var rows = files.reduce(function (sum, f) {
        var rowCount = f.last_synced_row_count != null ? f.last_synced_row_count : f.row_count;
        return sum + Number(rowCount || 0);
      }, 0);
      var duration = files.reduce(function (sum, f) {
        return sum + Number(f.duration_sec || 0);
      }, 0);
      state.dataSummary = { file_count: files.length, total_rows: rows, total_duration_sec: duration };
      if (dom.summaryFiles) dom.summaryFiles.textContent = String(files.length);
      if (dom.summaryRows) dom.summaryRows.textContent = String(rows);
      if (dom.summaryTime) dom.summaryTime.textContent = duration ? formatDuration(duration) : '--';
    }

    function datasetConfigFromDom() {
      return {
        input_dir: (dom.inputDatasetInput && dom.inputDatasetInput.value) || state.dataset.inputDir,
        output_dir: (dom.inputDatasetOutput && dom.inputDatasetOutput.value) || state.dataset.outputDir,
        feature_set: (dom.selectDatasetFeature && dom.selectDatasetFeature.value) || state.dataset.featureSet,
        window_size: parseInt(dom.inputDatasetWindow && dom.inputDatasetWindow.value) || state.dataset.windowSize,
        step_size: parseInt(dom.inputDatasetStep && dom.inputDatasetStep.value) || state.dataset.stepSize,
        scaler: (dom.selectDatasetScaler && dom.selectDatasetScaler.value) || state.dataset.scaler,
        trim_start_sec: parseFloat(dom.inputDatasetTrimStart && dom.inputDatasetTrimStart.value) || 0,
        trim_end_sec: parseFloat(dom.inputDatasetTrimEnd && dom.inputDatasetTrimEnd.value) || 0,
        allow_same_run_split: !!(dom.inputDatasetSameRun && dom.inputDatasetSameRun.checked),
      };
    }

    function startDatasetBuild() {
      var cfg = datasetConfigFromDom();
      state.dataset.inputDir = cfg.input_dir;
      state.dataset.outputDir = cfg.output_dir;
      state.dataset.featureSet = cfg.feature_set;
      state.dataset.windowSize = cfg.window_size;
      state.dataset.stepSize = cfg.step_size;
      state.dataset.scaler = cfg.scaler;
      state.dataset.trimStart = cfg.trim_start_sec;
      state.dataset.trimEnd = cfg.trim_end_sec;
      state.dataset.allowSameRunSplit = cfg.allow_same_run_split;
      state.dataset.building = true;
      state.dataset.buildId = '';
      state.dataset.buildLog = [];
      state.dataset.buildResult = null;
      state.dataset.buildError = '';
      state.dataset.localBuildId = null;
      renderDatasetBuilder();
      dbStartDatasetBuildRecord(cfg);

      root.Collection.apiPost(apiUrl, '/api/dataset/build', cfg, function (err, data) {
        if (err) {
          state.dataset.building = false;
          state.dataset.buildError = err;
          dbFinishDatasetBuildRecord({
            status: 'error',
            error: err,
            log: state.dataset.buildLog,
          });
          renderDatasetBuilder();
          return;
        }
        state.dataset.buildId = data.build_id || '';
        dbUpdateDatasetBuildRecord({
          buildId: state.dataset.buildId,
          status: 'running',
          log: state.dataset.buildLog,
        });
        addLog('Dataset build started: ' + state.dataset.buildId, 'event-subscribed');
        startDatasetPolling();
      });
    }

    function startDatasetPolling() {
      if (state.dataset.pollTimer) clearInterval(state.dataset.pollTimer);
      if (!state.dataset.buildId) return;
      state.dataset.pollTimer = setInterval(pollDatasetBuild, 1500);
      pollDatasetBuild();
    }

    function pollDatasetBuild() {
      if (!state.dataset.buildId) return;
      apiGet('/api/dataset/status', { build_id: state.dataset.buildId }, function (err, data) {
        if (err) {
          state.dataset.buildError = err;
          dbUpdateDatasetBuildRecord({
            status: 'poll_error',
            error: err,
            log: state.dataset.buildLog,
          });
          renderDatasetBuilder();
          return;
        }
        state.dataset.buildLog = data.log_lines || [];
        dbUpdateDatasetBuildRecord({
          buildId: state.dataset.buildId,
          status: data.state || 'running',
          log: state.dataset.buildLog,
        });
        if (data.state === 'done' || data.state === 'error') {
          state.dataset.building = false;
          if (state.dataset.pollTimer) {
            clearInterval(state.dataset.pollTimer);
            state.dataset.pollTimer = null;
          }
          if (data.state === 'done') {
            state.dataset.buildResult = data.result || {};
            state.dataset.buildError = '';
            dbFinishDatasetBuildRecord({
              buildId: state.dataset.buildId,
              status: 'done',
              result: state.dataset.buildResult,
              log: state.dataset.buildLog,
            });
            refreshDatasets();
          } else {
            state.dataset.buildError = 'Build failed - check log';
            dbFinishDatasetBuildRecord({
              buildId: state.dataset.buildId,
              status: 'error',
              error: state.dataset.buildError,
              log: state.dataset.buildLog,
            });
          }
        }
        renderDatasetBuilder();
      });
    }

    function refreshDatasets() {
      var dir = (dom.inputDatasetOutput && dom.inputDatasetOutput.value) || state.dataset.outputDir;
      apiGet('/api/dataset/list', { dir: dir }, function (err, data) {
        if (err) {
          state.dataset.datasets = [];
          state.dataset.buildError = err;
        } else {
          state.dataset.datasets = (data && data.datasets) || [];
        }
        renderDatasetBuilder();
      });
    }

    function renderDatasetBuilder() {
      if (dom.btnDatasetBuild) dom.btnDatasetBuild.disabled = state.dataset.building || state.connection.status !== 'online';
      if (dom.datasetStatusText) {
        if (state.dataset.building) dom.datasetStatusText.textContent = 'running: ' + (state.dataset.buildId || 'starting');
        else if (state.dataset.buildError) dom.datasetStatusText.textContent = 'error: ' + state.dataset.buildError;
        else if (state.dataset.buildResult) dom.datasetStatusText.textContent = 'done';
        else dom.datasetStatusText.textContent = 'idle';
      }
      if (dom.datasetLog) {
        dom.datasetLog.textContent = state.dataset.buildLog.length ? state.dataset.buildLog.slice(-80).join('\n') : '--';
      }
      if (dom.datasetResult) {
        var r = state.dataset.buildResult;
        if (r) {
          dom.datasetResult.textContent = 'train=' + (r.train_samples != null ? r.train_samples : '--') +
            ' test=' + (r.test_samples != null ? r.test_samples : '--') +
            ' features=' + (r.num_features != null ? r.num_features : '--') +
            ' window=' + (r.window_size != null ? r.window_size : '--');
        } else {
          dom.datasetResult.textContent = '--';
        }
      }
      if (dom.datasetList) {
        if (!state.dataset.datasets.length) {
          dom.datasetList.innerHTML = '<div class="dataset-row muted">' + t('noData') + '</div>';
        } else {
          dom.datasetList.innerHTML = state.dataset.datasets.map(function (ds) {
            var cfg = ds.config || {};
            return '<div class="dataset-row"><span title="' + escHtml(ds.path || '') + '">' + escHtml(ds.name || '') +
              '</span><small>' + escHtml((cfg.feature_set || '--') + ' ' + (cfg.train_samples || 0) + '+' + (cfg.test_samples || 0)) + '</small></div>';
          }).join('');
        }
      }
    }

    function renderDatasetBuildHistory() {
      if (!dom.datasetBuildHistoryBody) return;
      var rows = state.dataset.recentBuilds || [];
      if (!rows.length) {
        dom.datasetBuildHistoryBody.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary);text-align:center;padding:20px;">' + t('noData') + '</td></tr>';
        return;
      }
      dom.datasetBuildHistoryBody.innerHTML = rows.map(function (row) {
        var started = row.startedAt ? new Date(row.startedAt).toLocaleString() : '--';
        var samples = '--';
        if (row.result) {
          samples = 'train=' + (row.result.train_samples == null ? '--' : row.result.train_samples) +
            ' test=' + (row.result.test_samples == null ? '--' : row.result.test_samples);
        }
        return '<tr>' +
          '<td title="' + escHtml(row.buildId || '') + '">' + escHtml(row.buildId || '(local)') + '</td>' +
          '<td>' + escHtml(row.status || '--') + '</td>' +
          '<td>' + escHtml((row.featureSet || '--') + ' / ' + (row.windowSize || '--') + 'x' + (row.stepSize || '--')) + '</td>' +
          '<td title="' + escHtml(samples) + '">' + escHtml(samples) + '</td>' +
          '<td title="' + escHtml(started) + '">' + escHtml(started) + '</td>' +
        '</tr>';
      }).join('');
    }

    function formatDuration(sec) {
      if (!sec || sec === 0) return '--';
      var m = Math.floor(sec / 60);
      var s = Math.floor(sec % 60);
      return m + 'm ' + s + 's';
    }

    function loadExperimentCsvFiles() {
      var dir = dom.inputExperimentOutput ? dom.inputExperimentOutput.value : state.experiment.outputDir;
      if (!dom.expCsvTableBody) return;
      if (!dir || !isOnline()) {
        dom.expCsvTableBody.innerHTML = '<tr><td colspan="3" style="color:var(--text-secondary);text-align:center;padding:20px;">Robot IP missing</td></tr>';
        return;
      }
      apiGet('/api/data/list', { dir: dir }, function (err, data) {
        if (!dom.expCsvTableBody) return;
        if (err || !data || !data.files || data.files.length === 0) {
          var message = err || (data && data.error) || t('noData');
          dom.expCsvTableBody.innerHTML = '<tr><td colspan="3" style="color:var(--text-secondary);text-align:center;padding:20px;">' + escHtml(message) + '</td></tr>';
          return;
        }
        var files = data.files.slice(0, 10);
        dom.expCsvTableBody.innerHTML = files.map(function (f) {
          var mtime = f.mtime ? new Date(f.mtime * 1000).toLocaleString() : '--';
          return '<tr><td>' + escHtml(truncateName(f.name, 25)) + '</td><td>' + formatSize(f.size || 0) + '</td><td>' + mtime + '</td></tr>';
        }).join('');
      });
    }

    function refreshLocaleText() {
      if (!state.collection.csvHttpDebug) {
        state.collection.csvHttpDebug = { label: t('csvHttpRendererInitialized'), detail: '', at: '' };
      }
      updateCsvHttpDebugView();
      renderCsvHttpLogView();
    }

    refreshLocaleText();
    if (dom.selectCsvPreviewRows && !dom.selectCsvPreviewRows.dataset.csvRowsBound) {
      dom.selectCsvPreviewRows.dataset.csvRowsBound = '1';
      dom.selectCsvPreviewRows.addEventListener('change', function () {
        state.csvPreview.rowLimit = Number(this.value) || 100;
        logCsv('row limit changed to ' + state.csvPreview.rowLimit, 'event-subscribed', 0);
        if (state.csvPreview.selectedFile) previewCSVFile(state.csvPreview.selectedFile);
        else renderCSVPreviewTable(state.csvPreview.preview);
      });
    }
    if (dom.btnCsvRefresh && !dom.btnCsvRefresh.dataset.csvRefreshBound) {
      dom.btnCsvRefresh.dataset.csvRefreshBound = '1';
      dom.btnCsvRefresh.addEventListener('click', function () {
        logCsv('manual refresh clicked', 'event-subscribed', 0);
        loadCSVFiles();
      });
    }
    if (dom.csvTableBody && !dom.csvTableBody.dataset.csvActionBound) {
      dom.csvTableBody.dataset.csvActionBound = '1';
      dom.csvTableBody.addEventListener('click', function (e) {
        var btn = e.target.closest('.csv-action-btn');
        if (!btn || !dom.csvTableBody.contains(btn)) return;
        var action = btn.dataset.action;
        var file = btn.dataset.file || '';
        logCsv(action + ' clicked ' + (file || '--'), 'event-subscribed', 0);
        if (action === 'preview') previewCSVFile(file);
        if (action === 'download') downloadCSVFile(file);
      });
    }

    return {
      loadCSVFiles: loadCSVFiles,
      renderCSVTable: renderCSVTable,
      previewCSVFile: previewCSVFile,
      renderCSVPreviewTable: renderCSVPreviewTable,
      downloadCSVFile: downloadCSVFile,
      loadDataSummary: loadDataSummary,
      startDatasetBuild: startDatasetBuild,
      refreshDatasets: refreshDatasets,
      renderDatasetBuilder: renderDatasetBuilder,
      refreshDatasetBuildHistory: refreshDatasetBuildHistory,
      loadExperimentCsvFiles: loadExperimentCsvFiles,
      syncActiveCsvFallback: syncActiveCsvFallback,
      refreshLocaleText: refreshLocaleText,
      formatSize: formatSize,
      truncateName: truncateName,
    };
  }

  root.DataWorkspace = {
    create: createDataWorkspace,
  };
})();
