const path = require('path');
const Database = require('better-sqlite3');

let db = null;
const SCHEMA_VERSION = 4;

function nowIso() {
  return new Date().toISOString();
}

function openDatabase(userDataPath) {
  if (db) return db;
  db = new Database(path.join(userDataPath, 'wheeltec.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate();
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
  const migrations = [
    { version: 1, name: 'base_tables', up: migrateBaseTables },
    { version: 2, name: 'dataset_build_tracking', up: migrateDatasetBuildTracking },
    { version: 3, name: 'experiment_tracking', up: migrateExperimentTracking },
    { version: 4, name: 'csv_row_cache', up: migrateCsvRowCache },
  ];

  migrations.forEach((migration) => {
    if (applied.has(migration.version)) return;
    const tx = db.transaction(() => {
      migration.up();
      db.prepare(`
        INSERT OR REPLACE INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
      `).run(migration.version, migration.name, nowIso());
    });
    tx();
  });
}

function migrateBaseTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS robot_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL UNIQUE,
      last_status TEXT NOT NULL DEFAULT 'unknown',
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS csv_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      robot_ip TEXT,
      directory TEXT NOT NULL,
      name TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      modified_at TEXT,
      row_count INTEGER,
      column_count INTEGER,
      indexed_at TEXT NOT NULL,
      UNIQUE(directory, name)
    );

    CREATE TABLE IF NOT EXISTS sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      robot_ip TEXT,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function migrateDatasetBuildTracking() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dataset_builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id TEXT UNIQUE,
      robot_ip TEXT,
      input_dir TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      feature_set TEXT,
      window_size INTEGER,
      step_size INTEGER,
      scaler TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT,
      config_json TEXT,
      log_json TEXT,
      error_text TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );
  `);

  ensureColumn('dataset_builds', 'robot_ip', 'TEXT');
  ensureColumn('dataset_builds', 'config_json', 'TEXT');
  ensureColumn('dataset_builds', 'log_json', 'TEXT');
  ensureColumn('dataset_builds', 'error_text', 'TEXT');
}

function migrateExperimentTracking() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      robot_ip TEXT,
      fault_type TEXT NOT NULL,
      wheels_json TEXT NOT NULL,
      alpha_json TEXT NOT NULL,
      motion_mode TEXT,
      expected_rate INTEGER,
      output_dir TEXT,
      duration_sec INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      rows_collected INTEGER DEFAULT 0,
      config_json TEXT,
      started_at TEXT NOT NULL,
      stopped_at TEXT,
      stop_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS experiment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER,
      event_type TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE SET NULL
    );
  `);
}

function migrateCsvRowCache() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS csv_rows (
      csv_file_id INTEGER NOT NULL,
      row_index INTEGER NOT NULL,
      row_json TEXT NOT NULL,
      PRIMARY KEY (csv_file_id, row_index),
      FOREIGN KEY (csv_file_id) REFERENCES csv_files(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_csv_rows_file_row
      ON csv_rows(csv_file_id, row_index);
  `);

  ensureColumn('csv_files', 'sync_status', "TEXT NOT NULL DEFAULT 'metadata'");
  ensureColumn('csv_files', 'last_synced_row_count', 'INTEGER DEFAULT 0');
  ensureColumn('csv_files', 'columns_json', 'TEXT');
  ensureColumn('csv_files', 'source_mtime', 'REAL');
  ensureColumn('csv_files', 'last_error', 'TEXT');
  ensureColumn('csv_files', 'last_synced_at', 'TEXT');
  ensureColumn('csv_files', 'duration_sec', 'REAL');
  ensureColumn('csv_files', 'start_time', 'REAL');
  ensureColumn('csv_files', 'end_time', 'REAL');
}

function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function getSchemaVersion() {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  return {
    current: row && row.version ? row.version : 0,
    target: SCHEMA_VERSION,
  };
}

function listSchemaMigrations() {
  return db.prepare(`
    SELECT version, name, applied_at AS appliedAt
    FROM schema_migrations
    ORDER BY version ASC
  `).all();
}

function startExperiment(payload) {
  payload = payload || {};
  const timestamp = nowIso();
  const info = db.prepare(`
    INSERT INTO experiments (
      run_id, robot_ip, fault_type, wheels_json, alpha_json, motion_mode,
      expected_rate, output_dir, duration_sec, status, rows_collected,
      config_json, started_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.runId || payload.run_id || null,
    payload.robotIp || payload.robot_ip || null,
    payload.faultType || payload.fault_type || 'normal',
    JSON.stringify(payload.wheels || {}),
    JSON.stringify(payload.alpha || {}),
    payload.motionMode || payload.motion_mode || null,
    payload.expectedRate == null ? null : Number(payload.expectedRate),
    payload.outputDir || payload.output_dir || null,
    payload.durationSec == null ? null : Number(payload.durationSec),
    payload.status || 'running',
    payload.rowsCollected == null ? 0 : Number(payload.rowsCollected),
    JSON.stringify(payload.config || payload),
    timestamp
  );
  addExperimentEvent(info.lastInsertRowid, 'started', payload);
  return { id: info.lastInsertRowid, startedAt: timestamp };
}

function updateExperiment(id, fields) {
  if (!id) return false;
  fields = fields || {};
  const current = db.prepare('SELECT * FROM experiments WHERE id = ?').get(id);
  if (!current) return false;
  const status = fields.status || current.status;
  const rowsCollected = fields.rowsCollected == null ? current.rows_collected : Number(fields.rowsCollected);
  const stoppedAt = fields.stoppedAt === undefined ? current.stopped_at : fields.stoppedAt;
  const stopReason = fields.stopReason === undefined ? current.stop_reason : fields.stopReason;
  db.prepare(`
    UPDATE experiments
    SET status = ?, rows_collected = ?, stopped_at = ?, stop_reason = ?
    WHERE id = ?
  `).run(status, rowsCollected, stoppedAt, stopReason, id);
  return true;
}

function finishExperiment(id, payload) {
  payload = payload || {};
  if (!id) return false;
  const stoppedAt = payload.stoppedAt || nowIso();
  const ok = updateExperiment(id, {
    status: payload.status || 'stopped',
    rowsCollected: payload.rowsCollected,
    stoppedAt,
    stopReason: payload.stopReason || 'manual',
  });
  if (ok) addExperimentEvent(id, 'stopped', payload);
  return ok;
}

function addExperimentEvent(experimentId, eventType, detail) {
  db.prepare(`
    INSERT INTO experiment_events (experiment_id, event_type, detail_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(experimentId || null, eventType || 'event', JSON.stringify(detail || {}), nowIso());
  return true;
}

function listExperiments(limit) {
  return db.prepare(`
    SELECT id, run_id AS runId, robot_ip AS robotIp, fault_type AS faultType,
           motion_mode AS motionMode, expected_rate AS expectedRate,
           output_dir AS outputDir, duration_sec AS durationSec, status,
           rows_collected AS rowsCollected, started_at AS startedAt,
           stopped_at AS stoppedAt, stop_reason AS stopReason
    FROM experiments
    ORDER BY started_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(100, Number(limit) || 20)));
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), nowIso());
  return true;
}

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch (_) {
    return fallback;
  }
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach((row) => {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch (_) {
      out[row.key] = row.value;
    }
  });
  return out;
}

function recordConnection(ip, status) {
  if (!ip) return false;
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO robot_connections (ip, last_status, last_seen_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET
      last_status = excluded.last_status,
      last_seen_at = excluded.last_seen_at
  `).run(ip, status || 'unknown', timestamp, timestamp);
  return true;
}

function listConnections(limit) {
  return db.prepare(`
    SELECT ip, last_status AS lastStatus, last_seen_at AS lastSeenAt, created_at AS createdAt
    FROM robot_connections
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(50, Number(limit) || 10)));
}

function startDatasetBuild(payload) {
  payload = payload || {};
  const timestamp = nowIso();
  const info = db.prepare(`
    INSERT INTO dataset_builds (
      build_id, robot_ip, input_dir, output_dir, feature_set, window_size,
      step_size, scaler, status, result_json, config_json, log_json,
      error_text, started_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    payload.buildId || payload.build_id || null,
    payload.robotIp || payload.robot_ip || null,
    payload.inputDir || payload.input_dir || '',
    payload.outputDir || payload.output_dir || '',
    payload.featureSet || payload.feature_set || null,
    payload.windowSize == null ? null : Number(payload.windowSize),
    payload.stepSize == null ? null : Number(payload.stepSize),
    payload.scaler || null,
    payload.status || 'starting',
    payload.result ? JSON.stringify(payload.result) : null,
    JSON.stringify(payload.config || payload),
    payload.log ? JSON.stringify(payload.log) : null,
    payload.error || null,
    timestamp
  );
  return { id: info.lastInsertRowid, startedAt: timestamp };
}

function updateDatasetBuild(id, fields) {
  if (!id) return false;
  fields = fields || {};
  const current = db.prepare('SELECT * FROM dataset_builds WHERE id = ?').get(id);
  if (!current) return false;
  const buildId = fields.buildId === undefined ? current.build_id : fields.buildId;
  const status = fields.status || current.status;
  const resultJson = fields.result === undefined ? current.result_json : JSON.stringify(fields.result || {});
  const logJson = fields.log === undefined ? current.log_json : JSON.stringify(fields.log || []);
  const errorText = fields.error === undefined ? current.error_text : fields.error;
  const finishedAt = fields.finishedAt === undefined ? current.finished_at : fields.finishedAt;
  db.prepare(`
    UPDATE dataset_builds
    SET build_id = ?, status = ?, result_json = ?, log_json = ?, error_text = ?, finished_at = ?
    WHERE id = ?
  `).run(buildId || null, status, resultJson, logJson, errorText || null, finishedAt || null, id);
  return true;
}

function finishDatasetBuild(id, payload) {
  payload = payload || {};
  return updateDatasetBuild(id, {
    buildId: payload.buildId,
    status: payload.status || 'done',
    result: payload.result,
    log: payload.log,
    error: payload.error || null,
    finishedAt: payload.finishedAt || nowIso(),
  });
}

function listDatasetBuilds(limit) {
  return db.prepare(`
    SELECT id, build_id AS buildId, robot_ip AS robotIp, input_dir AS inputDir,
           output_dir AS outputDir, feature_set AS featureSet,
           window_size AS windowSize, step_size AS stepSize, scaler, status,
           result_json AS resultJson, error_text AS errorText,
           started_at AS startedAt, finished_at AS finishedAt
    FROM dataset_builds
    ORDER BY started_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(100, Number(limit) || 20))).map((row) => {
    try {
      row.result = row.resultJson ? JSON.parse(row.resultJson) : null;
    } catch (_) {
      row.result = null;
    }
    delete row.resultJson;
    return row;
  });
}

function indexCsvFiles(payload) {
  const directory = payload && payload.directory;
  const files = (payload && payload.files) || [];
  const robotIp = payload && payload.robotIp;
  if (!directory || !Array.isArray(files)) return { indexed: 0 };
  const timestamp = nowIso();
  const stmt = db.prepare(`
    INSERT INTO csv_files (
      robot_ip, directory, name, size_bytes, modified_at, row_count, column_count,
      indexed_at, source_mtime, sync_status, last_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT sync_status FROM csv_files WHERE directory = ? AND name = ?), 'metadata'), NULL)
    ON CONFLICT(directory, name) DO UPDATE SET
      robot_ip = excluded.robot_ip,
      size_bytes = excluded.size_bytes,
      modified_at = excluded.modified_at,
      source_mtime = excluded.source_mtime,
      sync_status = CASE
        WHEN csv_files.source_mtime IS NOT excluded.source_mtime
          OR csv_files.size_bytes != excluded.size_bytes
        THEN 'metadata'
        ELSE csv_files.sync_status
      END,
      row_count = COALESCE(excluded.row_count, csv_files.row_count),
      column_count = COALESCE(excluded.column_count, csv_files.column_count),
      indexed_at = excluded.indexed_at,
      last_error = NULL
  `);
  const tx = db.transaction((rows) => {
    rows.forEach((file) => {
      if (!file || !file.name) return;
      const sourceMtime = file.mtime == null ? null : Number(file.mtime);
      stmt.run(
        robotIp || null,
        directory,
        file.name,
        Number(file.size || file.size_bytes || 0),
        file.modified || file.modified_at || (file.mtime ? new Date(Number(file.mtime) * 1000).toISOString() : null),
        file.row_count == null ? null : Number(file.row_count),
        file.column_count == null ? null : Number(file.column_count),
        timestamp,
        sourceMtime,
        directory,
        file.name
      );
    });
  });
  tx(files);
  return { indexed: files.length };
}

function listCsvFiles(directory) {
  if (!directory) return [];
  return db.prepare(`
    SELECT id, robot_ip AS robotIp, directory, name, size_bytes AS sizeBytes,
           modified_at AS modifiedAt, row_count AS rowCount,
           column_count AS columnCount, indexed_at AS indexedAt,
           sync_status AS syncStatus, last_synced_row_count AS lastSyncedRowCount,
           columns_json AS columnsJson, source_mtime AS sourceMtime,
           last_error AS lastError, last_synced_at AS lastSyncedAt,
           duration_sec AS durationSec, start_time AS startTime, end_time AS endTime
    FROM csv_files
    WHERE directory = ?
    ORDER BY modified_at DESC, indexed_at DESC
  `).all(directory).map((row) => {
    try {
      row.columns = row.columnsJson ? JSON.parse(row.columnsJson) : [];
    } catch (_) {
      row.columns = [];
    }
    delete row.columnsJson;
    return row;
  });
}

function syncCsvPreview(payload) {
  payload = payload || {};
  const directory = payload.directory;
  const name = payload.name || (payload.preview && payload.preview.name);
  const preview = payload.preview || {};
  if (!directory || !name) return { error: 'directory and name required' };

  const rows = Array.isArray(preview.rows) ? preview.rows : [];
  const columns = Array.isArray(preview.columns) ? preview.columns : [];
  const timestamp = nowIso();
  const size = Number(preview.size || payload.size || 0);
  const sourceMtime = preview.mtime == null ? payload.sourceMtime : Number(preview.mtime);
  const modifiedAt = sourceMtime ? new Date(sourceMtime * 1000).toISOString() : null;
  const rowCount = preview.row_count == null ? rows.length : Number(preview.row_count);
  const complete = rowCount === rows.length;
  const syncStatus = complete ? 'complete' : 'partial';

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO csv_files (
        robot_ip, directory, name, size_bytes, modified_at, row_count, column_count,
        indexed_at, sync_status, last_synced_row_count, columns_json, source_mtime,
        last_error, last_synced_at, duration_sec, start_time, end_time
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(directory, name) DO UPDATE SET
        robot_ip = excluded.robot_ip,
        size_bytes = excluded.size_bytes,
        modified_at = excluded.modified_at,
        row_count = excluded.row_count,
        column_count = excluded.column_count,
        indexed_at = excluded.indexed_at,
        sync_status = excluded.sync_status,
        last_synced_row_count = excluded.last_synced_row_count,
        columns_json = excluded.columns_json,
        source_mtime = excluded.source_mtime,
        last_error = NULL,
        last_synced_at = excluded.last_synced_at,
        duration_sec = excluded.duration_sec,
        start_time = excluded.start_time,
        end_time = excluded.end_time
    `).run(
      payload.robotIp || null,
      directory,
      name,
      size,
      modifiedAt,
      rowCount,
      columns.length,
      timestamp,
      syncStatus,
      rows.length,
      JSON.stringify(columns),
      sourceMtime == null ? null : sourceMtime,
      timestamp,
      preview.duration_sec == null ? null : Number(preview.duration_sec),
      preview.start_time == null ? null : Number(preview.start_time),
      preview.end_time == null ? null : Number(preview.end_time)
    );

    const file = db.prepare('SELECT id FROM csv_files WHERE directory = ? AND name = ?').get(directory, name);
    if (!file) throw new Error('failed to resolve csv file id');
    db.prepare('DELETE FROM csv_rows WHERE csv_file_id = ?').run(file.id);
    const rowStmt = db.prepare(`
      INSERT INTO csv_rows (csv_file_id, row_index, row_json)
      VALUES (?, ?, ?)
    `);
    rows.forEach((row, idx) => {
      rowStmt.run(file.id, idx, JSON.stringify(row || {}));
    });
    return file.id;
  });

  const fileId = tx();
  return { id: fileId, syncedRows: rows.length, rowCount, syncStatus };
}

function markCsvSyncError(payload) {
  payload = payload || {};
  const directory = payload.directory;
  const name = payload.name;
  if (!directory || !name) return false;
  db.prepare(`
    UPDATE csv_files
    SET sync_status = CASE WHEN last_synced_row_count > 0 THEN sync_status ELSE 'error' END,
        last_error = ?,
        indexed_at = ?
    WHERE directory = ? AND name = ?
  `).run(payload.error || 'sync failed', nowIso(), directory, name);
  return true;
}

function getCsvPreviewFromDb(directory, name, limit) {
  if (!directory || !name) return null;
  const file = db.prepare(`
    SELECT id, robot_ip AS robotIp, directory, name, size_bytes AS size,
           modified_at AS modifiedAt, row_count AS row_count,
           column_count AS column_count, sync_status AS sync_status,
           last_synced_row_count AS last_synced_row_count,
           columns_json AS columnsJson, source_mtime AS mtime,
           last_error AS last_error, last_synced_at AS last_synced_at,
           duration_sec AS duration_sec, start_time AS start_time, end_time AS end_time
    FROM csv_files
    WHERE directory = ? AND name = ?
  `).get(directory, name);
  if (!file) return null;

  let columns = [];
  try {
    columns = file.columnsJson ? JSON.parse(file.columnsJson) : [];
  } catch (_) {
    columns = [];
  }
  delete file.columnsJson;

  const maxRows = Math.max(1, Math.min(200000, Number(limit) || 100));
  const rows = db.prepare(`
    SELECT row_index AS rowIndex, row_json AS rowJson
    FROM csv_rows
    WHERE csv_file_id = ?
    ORDER BY row_index ASC
    LIMIT ?
  `).all(file.id, maxRows).map((row) => {
    try {
      return JSON.parse(row.rowJson);
    } catch (_) {
      return {};
    }
  });

  return {
    id: file.id,
    directory: file.directory,
    name: file.name,
    size: file.size,
    mtime: file.mtime,
    modified_at: file.modifiedAt,
    columns,
    rows,
    row_count: file.row_count == null ? rows.length : file.row_count,
    column_count: file.column_count == null ? columns.length : file.column_count,
    sampled_points: rows.length,
    sync_status: file.sync_status || 'metadata',
    last_synced_row_count: file.last_synced_row_count || 0,
    last_error: file.last_error || '',
    last_synced_at: file.last_synced_at || '',
    duration_sec: file.duration_sec,
    start_time: file.start_time,
    end_time: file.end_time,
  };
}

function addSyncEvent(eventType, robotIp, detail) {
  db.prepare(`
    INSERT INTO sync_events (event_type, robot_ip, detail_json, created_at)
    VALUES (?, ?, ?, ?)
  `).run(eventType, robotIp || null, JSON.stringify(detail || {}), nowIso());
  return true;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  openDatabase,
  closeDatabase,
  getSchemaVersion,
  listSchemaMigrations,
  startDatasetBuild,
  updateDatasetBuild,
  finishDatasetBuild,
  listDatasetBuilds,
  startExperiment,
  updateExperiment,
  finishExperiment,
  addExperimentEvent,
  listExperiments,
  setSetting,
  getSetting,
  getSettings,
  recordConnection,
  listConnections,
  indexCsvFiles,
  listCsvFiles,
  syncCsvPreview,
  markCsvSyncError,
  getCsvPreviewFromDb,
  addSyncEvent,
};
