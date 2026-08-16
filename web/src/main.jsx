import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle } from 'lucide-react';
import { useRosbridge } from './hooks/useRosbridge';
import { useKeyboard } from './hooks/useKeyboard';
import { useGamepad } from './hooks/useGamepad';
import { useLang } from './i18n';
import { LIMITS, clamp, axis, twist, emptyTwist, normalizeVector, parseCruiseStatus, parseJsonStatus, apiUrl } from './utils';
import './styles.css';

import TopBar from './components/TopBar';
import ConnectionPanel from './components/ConnectionPanel';
import MetricsBar from './components/MetricsBar';
import ManualDrive from './components/ManualDrive';
import CruiseControl from './components/CruiseControl';
import HeadingAngle from './components/HeadingAngle';
import DataCollection from './components/DataCollection';
import FaultInjection from './components/FaultInjection';
import DatasetBuilder from './components/DatasetBuilder';
import TelemetryBar from './components/TelemetryBar';
import EventLog from './components/EventLog';
import ExperimentWizard from './components/ExperimentWizard';
import DataVisualization from './components/DataVisualization';
import QualityPanel from './components/QualityPanel';
import DatasetStats from './components/DatasetStats';

function getInitialTheme() {
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function metricNumber(value) {
  const n = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function faultMetaFromState(faultInjection) {
  const active = Boolean(faultInjection.enableFault) && faultInjection.faultType === 'drive_abnormal';
  const selected = ['A', 'B', 'C'].filter((wheel) => faultInjection.wheels?.[wheel]);
  const enabledAlphas = selected.map((wheel) => Number(faultInjection.alpha?.[wheel] ?? 1));
  const alphaValue = active && enabledAlphas.length > 0 ? Math.min(...enabledAlphas) : 1.0;
  return {
    fault_label: active && selected.length > 0 ? 1 : 0,
    fault_name: active && selected.length > 0 ? 'drive_abnormal' : 'normal',
    label: active && selected.length > 0 ? 1 : 0,
    fault_type: active && selected.length > 0 ? 'drive_abnormal' : 'normal',
    fault_wheel: active && selected.length > 0 ? selected.join('+') : 'none',
    fault_alpha: alphaValue,
  };
}

const initialState = {
  imuTopic: '/n100/imu',
  stick: { x: 0, y: 0 },
  lateral: 0,
  mult: 1,
  cruiseSpeed: 0.2,
  cruiseDirection: { x: 1, y: 0 },
  cruiseStatus: parseCruiseStatus('cruise: off'),
  targetAngle: 0,
  angleState: 'idle',
  controlStatus: 'idle',
  telemetry: { voltage: '--', vx: '0.00', vy: '0.00', wz: '0.00', imuZ: '--', heading: '--', headingSource: '--', odomX: '--', odomY: '--', c0: '--', c1: '--', c2: '--' },
  collection: {
    currentPort: '/dev/ttyUSB1',
    outputDir: '/home/wheeltec/R550PLUS_data_collect/log_v2',
    faultLabel: 0,
    faultName: 'normal',
    faultMode: 0,
    runId: '',
    motionMode: 'straight_back_forth_0.25ms',
    expectedRate: 20,
    status: { state: 'idle', collecting: false, sample_id: 0 },
    current: { connected: false, port: '/dev/ttyUSB1', valid_total: 0 },
    files: [],
    fileError: '',
    showAdvanced: false,
    autoStopDuration: 0,
  },
  experiment: {
    faultType: 'normal',
    wheels: { A: false, B: true, C: false },
    alpha: { A: 1, B: 0.5, C: 1 },
    runId: '',
    motionMode: 'straight_back_forth_0.25ms',
    durationSec: 60,
    expectedRate: 20,
  },
  faultInjection: {
    enableFault: false,
    faultType: 'normal',
    wheels: { A: false, B: true, C: false },
    alpha: { A: 1, B: 0.5, C: 1 },
    status: {},
  },
  dataset: {
    featureSet: '15ch',
    windowSize: 50,
    stepSize: 10,
    scaler: 'standard',
    trimStart: 5,
    trimEnd: 5,
    allowSameRunSplit: false,
    inputDir: '/home/wheeltec/R550PLUS_data_collect/log_v2',
    outputDir: '/home/wheeltec/R550PLUS_dataset/four_class_v1',
    building: false,
    buildLog: [],
    buildResult: null,
    buildError: '',
    buildId: '',
  },
  visualization: {
    liveData: [],
    selectedFile: '',
    preview: null,
    previewLoading: false,
    previewError: '',
  },
  dataSummary: null,
  activeWorkspaceTab: 'experiment',
  log: [],
  theme: getInitialTheme(),
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_IMU_TOPIC': return { ...state, imuTopic: action.value };
    case 'SET_STICK': return { ...state, stick: action.value };
    case 'SET_LATERAL': return { ...state, lateral: action.value };
    case 'SET_MULT': return { ...state, mult: action.value };
    case 'SET_CRUISE_SPEED': return { ...state, cruiseSpeed: action.value };
    case 'SET_CRUISE_DIRECTION': return { ...state, cruiseDirection: action.value };
    case 'SET_CRUISE_STATUS': return { ...state, cruiseStatus: action.value };
    case 'SET_TARGET_ANGLE': return { ...state, targetAngle: action.value };
    case 'SET_ANGLE_STATE': return { ...state, angleState: action.value };
    case 'SET_CONTROL_STATUS': return { ...state, controlStatus: action.value };
    case 'SET_TELEMETRY': return { ...state, telemetry: { ...state.telemetry, ...action.value } };
    case 'SET_COLLECTION': return { ...state, collection: { ...state.collection, ...action.value } };
    case 'SET_EXPERIMENT': return { ...state, experiment: { ...state.experiment, ...action.value } };
    case 'SET_DATASET': return { ...state, dataset: { ...state.dataset, ...action.value } };
    case 'SET_FAULT_INJECTION': return { ...state, faultInjection: { ...state.faultInjection, ...action.value } };
    case 'SET_VISUALIZATION': return { ...state, visualization: { ...state.visualization, ...action.value } };
    case 'SET_DATA_SUMMARY': return { ...state, dataSummary: action.value };
    case 'SET_WORKSPACE_TAB': return { ...state, activeWorkspaceTab: action.value };
    case 'ADD_LOG': return { ...state, log: [`${new Date().toLocaleTimeString()}  ${action.text}`, ...state.log].slice(0, 12) };
    case 'SET_THEME': return { ...state, theme: action.value };
    default: return state;
  }
}

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { t, lang, toggle: toggleLang } = useLang();

  const defaultUrl = `ws://${window.location.hostname || '127.0.0.1'}:9090`;
  const ros = useRosbridge(defaultUrl);

  const addLog = useCallback((text) => dispatch({ type: 'ADD_LOG', text }), []);
  const pendingTelemetryRef = useRef({});
  const telemetryTimerRef = useRef(null);
  const pendingCollectionRef = useRef({});
  const collectionTimerRef = useRef(null);
  const pendingFaultInjectionRef = useRef({});
  const faultInjectionTimerRef = useRef(null);

  const queueTelemetry = useCallback((value) => {
    pendingTelemetryRef.current = { ...pendingTelemetryRef.current, ...value };
    if (telemetryTimerRef.current) return;
    telemetryTimerRef.current = window.setTimeout(() => {
      telemetryTimerRef.current = null;
      const pending = pendingTelemetryRef.current;
      pendingTelemetryRef.current = {};
      dispatch({ type: 'SET_TELEMETRY', value: pending });
    }, 100);
  }, []);

  const queueCollection = useCallback((value) => {
    pendingCollectionRef.current = { ...pendingCollectionRef.current, ...value };
    if (collectionTimerRef.current) return;
    collectionTimerRef.current = window.setTimeout(() => {
      collectionTimerRef.current = null;
      const pending = pendingCollectionRef.current;
      pendingCollectionRef.current = {};
      dispatch({ type: 'SET_COLLECTION', value: pending });
    }, 150);
  }, []);

  const queueFaultInjection = useCallback((value) => {
    pendingFaultInjectionRef.current = { ...pendingFaultInjectionRef.current, ...value };
    if (faultInjectionTimerRef.current) return;
    faultInjectionTimerRef.current = window.setTimeout(() => {
      faultInjectionTimerRef.current = null;
      const pending = pendingFaultInjectionRef.current;
      pendingFaultInjectionRef.current = {};
      dispatch({ type: 'SET_FAULT_INJECTION', value: pending });
    }, 150);
  }, []);

  useEffect(() => () => {
    if (telemetryTimerRef.current) window.clearTimeout(telemetryTimerRef.current);
    if (collectionTimerRef.current) window.clearTimeout(collectionTimerRef.current);
    if (faultInjectionTimerRef.current) window.clearTimeout(faultInjectionTimerRef.current);
  }, []);

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', state.theme);
    try { localStorage.setItem('theme', state.theme); } catch {}
  }, [state.theme]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const point = {
        t: new Date().toLocaleTimeString(),
        c0: metricNumber(state.telemetry.c0),
        c1: metricNumber(state.telemetry.c1),
        c2: metricNumber(state.telemetry.c2),
        voltage: metricNumber(state.telemetry.voltage),
        vx: metricNumber(state.telemetry.vx),
        vy: metricNumber(state.telemetry.vy),
        wz: metricNumber(state.telemetry.wz),
        imuZ: metricNumber(state.telemetry.imuZ),
      };
      dispatch({
        type: 'SET_VISUALIZATION',
        value: { liveData: [...state.visualization.liveData, point].slice(-180) },
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.telemetry, state.visualization.liveData]);

  const toggleTheme = useCallback(() => {
    dispatch({ type: 'SET_THEME', value: state.theme === 'dark' ? 'light' : 'dark' });
  }, [state.theme]);

  // Cruise command
  const cruiseVector = useMemo(() => normalizeVector(state.cruiseDirection), [state.cruiseDirection]);
  const cruiseCmd = useMemo(() => {
    const speed = clamp(Number(state.cruiseSpeed) || 0, 0, LIMITS.maxLinear);
    return twist(cruiseVector.x * speed, cruiseVector.y * speed, 0);
  }, [state.cruiseSpeed, cruiseVector]);

  // Manual drive command
  const command = useMemo(() => {
    const drive = axis(-state.stick.y);
    const turn = axis(state.stick.x);
    const lat = axis(state.lateral);
    return twist(drive * LIMITS.maxLinear * state.mult, lat * LIMITS.maxLateral * state.mult, -turn * LIMITS.maxAngular * state.mult);
  }, [state.stick, state.lateral, state.mult]);

  // Subscribe to ROS topics
  useEffect(() => {
    const unsubs = [];
    unsubs.push(ros.subscribe('/PowerVoltage', 'std_msgs/Float32', (msg) => queueTelemetry({ voltage: `${Number(msg.data || 0).toFixed(2)} V` })));
    unsubs.push(ros.subscribe('/current_data', 'std_msgs/Float32MultiArray', (msg) => {
      const d = msg.data || [];
      queueTelemetry({ c0: `${Number(d[0] || 0).toFixed(3)} A`, c1: `${Number(d[1] || 0).toFixed(3)} A`, c2: `${Number(d[2] || 0).toFixed(3)} A` });
    }));
    unsubs.push(ros.subscribe(state.imuTopic, 'sensor_msgs/Imu', (msg) => queueTelemetry({ imuZ: Number(msg.angular_velocity?.z || 0).toFixed(3) })));
    unsubs.push(ros.subscribe('/chassis/heading_deg', 'std_msgs/Float32', (msg) => {
      const value = Number(msg.data);
      queueTelemetry({ heading: Number.isFinite(value) ? value.toFixed(1) : '--' });
    }));
    unsubs.push(ros.subscribe('/web/heading_status', 'std_msgs/String', (msg) => {
      const parsed = parseJsonStatus(msg.data, {});
      const heading = Number(parsed.heading_deg);
      queueTelemetry(
        Number.isFinite(heading)
          ? { headingSource: parsed.source || parsed.mode || msg.data || '--', heading: heading.toFixed(1) }
          : { headingSource: parsed.source || parsed.mode || msg.data || '--' },
      );
    }));
    unsubs.push(ros.subscribe('/odom', 'nav_msgs/Odometry', (msg) => {
      const tw = msg.twist?.twist || {};
      const po = msg.pose?.pose || {};
      queueTelemetry({
        vx: Number(tw.linear?.x || 0).toFixed(2),
        vy: Number(tw.linear?.y || 0).toFixed(2),
        wz: Number(tw.angular?.z || 0).toFixed(2),
        odomX: Number(po.position?.x || 0).toFixed(2),
        odomY: Number(po.position?.y || 0).toFixed(2),
      });
    }));
    unsubs.push(ros.subscribe('/web/control_status', 'std_msgs/String', (msg) => dispatch({ type: 'SET_CONTROL_STATUS', value: msg.data || 'idle' })));
    unsubs.push(ros.subscribe('/web/cruise_status', 'std_msgs/String', (msg) => dispatch({ type: 'SET_CRUISE_STATUS', value: parseCruiseStatus(msg.data || '') })));
    unsubs.push(ros.subscribe('/web/collection_status', 'std_msgs/String', (msg) => {
      queueCollection({ status: parseJsonStatus(msg.data, { state: 'idle', collecting: false, sample_id: 0 }) });
    }));
    unsubs.push(ros.subscribe('/web/current_reader_status', 'std_msgs/String', (msg) => {
      const parsed = parseJsonStatus(msg.data, { connected: false });
      queueCollection({ current: parsed });
    }));
    unsubs.push(ros.subscribe('/web/fault_injection_status', 'std_msgs/String', (msg) => {
      queueFaultInjection({ status: parseJsonStatus(msg.data, {}) });
    }));
    return () => unsubs.forEach((unsubscribe) => unsubscribe && unsubscribe());
  }, [ros.subscribe, state.imuTopic, state.collection.currentPort, queueTelemetry, queueCollection, queueFaultInjection]);

  // Heartbeat + command sender
  useEffect(() => {
    const heartbeat = setInterval(() => ros.publish('/web/heartbeat', {}), LIMITS.heartbeatMs);
    const sender = setInterval(() => {
      if (!state.cruiseStatus.active) ros.publish('/cmd_vel_web', command);
    }, LIMITS.commandMs);
    return () => { clearInterval(heartbeat); clearInterval(sender); };
  }, [ros.publish, command, state.cruiseStatus.active]);

  // Stop function
  const stop = useCallback(() => {
    dispatch({ type: 'SET_STICK', value: { x: 0, y: 0 } });
    dispatch({ type: 'SET_LATERAL', value: 0 });
    ros.publish('/web/test_enable', { data: false });
    ros.publish('/web/cruise_enable', { data: false });
    ros.publish('/cmd_vel_web', emptyTwist());
    addLog('Stop command sent');
  }, [ros.publish, addLog]);

  // Keyboard
  useKeyboard(dispatch, stop);

  // Gamepad
  const gamepadAxes = useCallback((axes) => {
    dispatch({ type: 'SET_STICK', value: { x: axes.turn, y: axes.y } });
    dispatch({ type: 'SET_LATERAL', value: axes.x });
  }, []);
  const gamepadEstop = useCallback(() => estop(true), []);
  const gamepad = useGamepad(gamepadAxes, stop, gamepadEstop);

  // E-stop
  function estop(active) {
    if (active) stop();
    ros.publish('/web/estop', { data: active });
    addLog(active ? 'E-stop locked' : 'E-stop released');
  }

  // Cruise
  function startCruise() {
    ros.publish('/web/cruise_cmd', cruiseCmd);
    ros.publish('/web/cruise_enable', { data: true });
    addLog(`Cruise start vx=${cruiseCmd.linear.x.toFixed(2)} vy=${cruiseCmd.linear.y.toFixed(2)}`);
  }

  function stopCruise() {
    ros.publish('/web/cruise_enable', { data: false });
    ros.publish('/cmd_vel_web', emptyTwist());
    addLog('Cruise stopped');
  }

  // Heading
  function sendAngle() {
    const angle = Number(state.targetAngle);
    if (!Number.isFinite(angle)) return;
    ros.publish('/target_angle', { data: angle });
    dispatch({ type: 'SET_ANGLE_STATE', value: `${angle.toFixed(1)} deg` });
    addLog(`Target angle ${angle.toFixed(1)} deg`);
  }

  function zeroAngle() {
    ros.publish('/target_angle_reset', {});
    ros.publish('/web/heading_zero', {});
    dispatch({ type: 'SET_TARGET_ANGLE', value: 0 });
    dispatch({ type: 'SET_ANGLE_STATE', value: 'current heading = 0 deg' });
    addLog('Current heading set as 0 deg');
  }

  function getFaultCollectionMeta(faultInjection = state.faultInjection) {
    return faultMetaFromState(faultInjection);
  }

  // Collection
  const collectionConfig = useMemo(() => {
    const faultMeta = getFaultCollectionMeta();
    return {
      output_dir: state.collection.outputDir,
      fault_label: faultMeta.fault_label,
      fault_name: faultMeta.fault_name,
      label: faultMeta.label,
      fault_type: faultMeta.fault_type,
      fault_wheel: faultMeta.fault_wheel,
      fault_alpha: faultMeta.fault_alpha,
      fault_mode: Number(state.collection.faultMode) || 0,
      run_id: state.collection.runId || '',
      motion_mode: state.collection.motionMode || 'straight_back_forth_0.25ms',
      expected_rate: Number(state.collection.expectedRate) || 20,
    };
  }, [state.collection.outputDir, state.collection.faultMode, state.collection.runId, state.collection.motionMode, state.collection.expectedRate, state.faultInjection]);

  const quality = useMemo(() => {
    const status = state.collection.status || {};
    const current = state.collection.current || {};
    const expected = Number(status.expected_rate || state.collection.expectedRate || 20);
    const durationSec = status.collecting && state.collection.startedAt
      ? Math.max(0, Math.round((Date.now() - state.collection.startedAt) / 1000))
      : 0;
    const estimated = durationSec > 0 ? Number(status.sample_id || 0) / durationSec : 0;
    const drift = expected > 0 && estimated > 0 ? Math.abs((estimated - expected) / expected) * 100 : 0;
    const reasons = [];
    if (!current.connected) reasons.push('current board offline');
    if (current.last_current_age != null && Number(current.last_current_age) > 2) reasons.push('current data stale');
    if (status.error) reasons.push(status.error);
    if (status.collecting && durationSec > 5 && drift > 25) reasons.push('sample rate drift');
    let level = reasons.length === 0 ? 'good' : 'warn';
    if (!current.connected || status.state === 'error') level = 'bad';
    return {
      level,
      reasons,
      durationSec,
      estimatedRate: estimated.toFixed(1),
      rateDrift: drift.toFixed(0),
      rateTone: drift > 25 ? 'bad' : drift > 10 ? 'warn' : 'good',
      currentTone: current.last_current_age != null && Number(current.last_current_age) > 2 ? 'bad' : 'good',
    };
  }, [state.collection]);

  function publishCollectionConfig(extra = {}) {
    return ros.publish('/web/collection_config', { data: JSON.stringify({ ...collectionConfig, ...extra }) });
  }

  function reconnectCurrentReader() {
    ros.publish('/web/current_reader_config', { data: JSON.stringify({ port: state.collection.currentPort, reconnect: true }) });
    addLog(`Current reader reconnect ${state.collection.currentPort}`);
  }

  function updateCurrentPortDraft(value) {
    dispatch({ type: 'SET_COLLECTION', value: { currentPort: value } });
  }

  const autoStopTimerRef = useRef(null);

  function startCollection() {
    publishCollectionConfig();
    ros.publish('/web/collection_enable', { data: true });
    dispatch({ type: 'SET_COLLECTION', value: { startedAt: Date.now() } });
    addLog(`Collection start ${state.collection.runId || '(auto run_id)'}`);
    setTimeout(refreshFiles, 800);

    // Auto-stop after duration
    const duration = Number(state.collection.autoStopDuration) || 0;
    if (duration > 0) {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = setTimeout(() => {
        stopCollection();
        addLog(`Auto-stopped after ${duration}s`);
      }, duration * 1000);
    }
  }

  function stopCollection() {
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    ros.publish('/web/collection_enable', { data: false });
    dispatch({ type: 'SET_COLLECTION', value: { startedAt: null } });
    addLog('Collection stopped');
    setTimeout(refreshFiles, 500);
  }

  async function refreshFiles() {
    try {
      const response = await fetch(apiUrl('/api/data/list', { dir: state.collection.outputDir }));
      const body = await response.json();
      dispatch({ type: 'SET_COLLECTION', value: { files: body.files || [], fileError: body.error || '' } });
      refreshSummary();
    } catch (e) {
      dispatch({ type: 'SET_COLLECTION', value: { fileError: String(e) } });
    }
  }

  async function refreshSummary() {
    try {
      const response = await fetch(apiUrl('/api/data/summary', { dir: state.collection.outputDir }));
      const body = await response.json();
      dispatch({ type: 'SET_DATA_SUMMARY', value: body });
    } catch {
      dispatch({ type: 'SET_DATA_SUMMARY', value: null });
    }
  }

  async function previewFile(name = state.visualization.selectedFile) {
    if (!name) return;
    dispatch({ type: 'SET_VISUALIZATION', value: { selectedFile: name, previewLoading: true, previewError: '' } });
    try {
      const response = await fetch(apiUrl('/api/data/preview', { dir: state.collection.outputDir, name, max_points: 800 }));
      const body = await response.json();
      if (body.error) {
        dispatch({ type: 'SET_VISUALIZATION', value: { preview: null, previewError: body.error, previewLoading: false } });
      } else {
        dispatch({ type: 'SET_VISUALIZATION', value: { preview: body, previewError: '', previewLoading: false } });
      }
    } catch (e) {
      dispatch({ type: 'SET_VISUALIZATION', value: { preview: null, previewError: String(e), previewLoading: false } });
    }
  }

  function downloadFile(name) {
    window.open(apiUrl(`/api/data/download/${encodeURIComponent(name)}`, { dir: state.collection.outputDir }), '_blank');
  }

  function onCollectionFieldChange(field, value) {
    dispatch({ type: 'SET_COLLECTION', value: { [field]: value } });
  }

  function onExperimentFieldChange(field, value) {
    if (field === 'outputDir') {
      dispatch({ type: 'SET_COLLECTION', value: { outputDir: value } });
      return;
    }
    dispatch({ type: 'SET_EXPERIMENT', value: { [field]: value } });
  }

  function resetExperimentWizard() {
    dispatch({
      type: 'SET_EXPERIMENT',
      value: {
        faultType: 'normal',
        wheels: { A: false, B: true, C: false },
        alpha: { A: 1, B: 0.5, C: 1 },
        runId: '',
        motionMode: 'straight_back_forth_0.25ms',
        durationSec: 60,
        expectedRate: 20,
      },
    });
  }

  function onDatasetFieldChange(field, value) {
    dispatch({ type: 'SET_DATASET', value: { [field]: value } });
  }

  // Fault injection
  const faultInjectionConfig = useMemo(() => ({
    enable_fault: state.faultInjection.enableFault,
    fault_type: state.faultInjection.faultType,
    wheels: state.faultInjection.wheels,
    alpha: {
      A: Number(state.faultInjection.alpha?.A ?? 1),
      B: Number(state.faultInjection.alpha?.B ?? 0.5),
      C: Number(state.faultInjection.alpha?.C ?? 1),
    },
  }), [state.faultInjection.enableFault, state.faultInjection.faultType, state.faultInjection.wheels, state.faultInjection.alpha]);

  function publishFaultInjectionConfig() {
    ros.publish('/web/fault_injection_config', { data: JSON.stringify(faultInjectionConfig) });
    const faultMeta = getFaultCollectionMeta(state.faultInjection);
    publishCollectionConfig(faultMeta);
    dispatch({
      type: 'SET_COLLECTION',
      value: {
        faultLabel: faultMeta.fault_label,
        faultName: faultMeta.fault_name,
      },
    });
    const selected = ['A', 'B', 'C'].filter((wheel) => faultInjectionConfig.wheels?.[wheel]).join('+') || 'none';
    addLog(`Fault config: ${faultInjectionConfig.enable_fault ? 'ON' : 'OFF'}, wheels=${selected}`);
  }

  function resetFaultInjection() {
    const resetState = {
      enableFault: false,
      faultType: 'normal',
      wheels: { A: false, B: true, C: false },
      alpha: { A: 1, B: 0.5, C: 1 },
    };
    const resetConfig = { enable_fault: false, fault_type: 'normal', wheels: resetState.wheels, alpha: resetState.alpha };
    dispatch({ type: 'SET_FAULT_INJECTION', value: resetState });
    ros.publish('/web/fault_injection_config', { data: JSON.stringify(resetConfig) });
    const faultMeta = getFaultCollectionMeta(resetState);
    publishCollectionConfig(faultMeta);
    dispatch({
      type: 'SET_COLLECTION',
      value: {
        faultLabel: faultMeta.fault_label,
        faultName: faultMeta.fault_name,
      },
    });
    addLog('Fault injection reset');
  }

  function onFaultInjectionFieldChange(field, value) {
    dispatch({ type: 'SET_FAULT_INJECTION', value: { [field]: value } });
  }

  function startGuidedExperiment() {
    const exp = state.experiment;
    const faultState = {
      enableFault: exp.faultType === 'drive_abnormal',
      faultType: exp.faultType === 'drive_abnormal' ? 'drive_abnormal' : 'normal',
      wheels: exp.wheels,
      alpha: exp.alpha,
    };
    const faultConfig = {
      enable_fault: faultState.enableFault,
      fault_type: faultState.faultType,
      wheels: faultState.wheels,
      alpha: {
        A: Number(faultState.alpha?.A ?? 1),
        B: Number(faultState.alpha?.B ?? 0.5),
        C: Number(faultState.alpha?.C ?? 1),
      },
    };
    const meta = exp.faultType === 'drive_abnormal'
      ? faultMetaFromState(faultState)
      : {
        fault_label: exp.faultType === 'wheel_slip' ? 2 : exp.faultType === 'shaft_eccentric' ? 3 : 0,
        fault_name: exp.faultType,
        label: exp.faultType === 'wheel_slip' ? 2 : exp.faultType === 'shaft_eccentric' ? 3 : 0,
        fault_type: exp.faultType,
        fault_wheel: 'none',
        fault_alpha: 1.0,
      };
    const runId = exp.runId || `${meta.fault_name}_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
    const duration = Number(exp.durationSec) || 0;
    const collectionPayload = {
      ...collectionConfig,
      ...meta,
      run_id: runId,
      motion_mode: exp.motionMode || state.collection.motionMode,
      expected_rate: Number(exp.expectedRate) || 20,
    };

    dispatch({ type: 'SET_FAULT_INJECTION', value: faultState });
    dispatch({
      type: 'SET_COLLECTION',
      value: {
        runId,
        motionMode: collectionPayload.motion_mode,
        expectedRate: collectionPayload.expected_rate,
        autoStopDuration: duration,
        faultLabel: meta.fault_label,
        faultName: meta.fault_name,
        startedAt: Date.now(),
      },
    });
    ros.publish('/web/fault_injection_config', { data: JSON.stringify(faultConfig) });
    ros.publish('/web/collection_config', { data: JSON.stringify(collectionPayload) });
    ros.publish('/web/collection_enable', { data: true });
    addLog(`Experiment start ${runId}`);
    setTimeout(refreshFiles, 800);
    if (duration > 0) {
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = setTimeout(() => {
        stopCollection();
        addLog(`Experiment auto-stopped after ${duration}s`);
      }, duration * 1000);
    }
  }

  useEffect(() => {
    refreshFiles();
  }, []);

  const workspaceTabs = [
    { id: 'drive', label: t('driveWorkspace') },
    { id: 'experiment', label: t('experimentWorkspace') },
    { id: 'analysis', label: t('analysisWorkspace') },
    { id: 'logs', label: t('logsWorkspace') },
  ];

  function renderDriveWorkspace() {
    return (
      <section className="workspacePage driveWorkspace">
        <ManualDrive
          stick={state.stick} lateral={state.lateral} mult={state.mult}
          onStop={stop}
          onStickChange={(v) => dispatch({ type: 'SET_STICK', value: v })}
          onStrafeLeft={(v) => dispatch({ type: 'SET_LATERAL', value: v })}
          onStrafeRight={(v) => dispatch({ type: 'SET_LATERAL', value: v })}
          t={t}
        />
        <CruiseControl
          speed={state.cruiseSpeed}
          direction={state.cruiseDirection}
          cruiseStatus={state.cruiseStatus}
          cruiseCmd={cruiseCmd}
          onDirectionChange={(d) => dispatch({ type: 'SET_CRUISE_DIRECTION', value: d })}
          onSpeedChange={(s) => dispatch({ type: 'SET_CRUISE_SPEED', value: s })}
          onStart={startCruise} onStop={stopCruise} t={t}
        />
        <HeadingAngle
          targetAngle={state.targetAngle}
          angleState={state.angleState}
          onAngleChange={(v) => dispatch({ type: 'SET_TARGET_ANGLE', value: v })}
          onSend={sendAngle} onZero={zeroAngle}
          onKeyDown={(e) => e.key === 'Enter' && sendAngle()}
          t={t}
        />
        <TelemetryBar telemetry={state.telemetry} t={t} />
      </section>
    );
  }

  function renderExperimentWorkspace() {
    return (
      <section className="workspacePage experimentWorkspace">
        <div className="experimentMain">
          <ExperimentWizard
            experiment={state.experiment}
            collection={state.collection}
            onFieldChange={onExperimentFieldChange}
            onStart={startGuidedExperiment}
            onReset={resetExperimentWizard}
            t={t}
          />
          <QualityPanel
            collection={state.collection}
            quality={quality}
              onCurrentPortChange={updateCurrentPortDraft}
            onReconnectCurrent={reconnectCurrentReader}
            t={t}
          />
        </div>
        <aside className="experimentSide">
          <DataCollection
            collection={state.collection}
            selectedFile={state.visualization.selectedFile}
            onFieldChange={onCollectionFieldChange}
            onStart={startCollection} onStop={stopCollection}
            onReconnect={reconnectCurrentReader} onRefresh={refreshFiles}
            onDownload={downloadFile}
            onPreview={previewFile}
            onToggleAdvanced={() => dispatch({ type: 'SET_COLLECTION', value: { showAdvanced: !state.collection.showAdvanced } })}
            t={t}
          />
          <FaultInjection
            faultInjection={state.faultInjection}
            onFieldChange={onFaultInjectionFieldChange}
            onApply={publishFaultInjectionConfig}
            onReset={resetFaultInjection}
            t={t}
          />
        </aside>
      </section>
    );
  }

  function renderAnalysisWorkspace() {
    return (
      <section className="workspacePage analysisWorkspace">
        <DataVisualization
          liveData={state.visualization.liveData}
          preview={state.visualization.preview}
          previewLoading={state.visualization.previewLoading}
          previewError={state.visualization.previewError}
          selectedFile={state.visualization.selectedFile}
          onRefreshPreview={() => previewFile()}
          t={t}
        />
        <DatasetStats summary={state.dataSummary} dataset={state.dataset} onRefresh={refreshSummary} t={t} />
        <DatasetBuilder
          dataset={state.dataset}
          onFieldChange={onDatasetFieldChange}
          t={t}
        />
      </section>
    );
  }

  function renderLogsWorkspace() {
    return (
      <section className="workspacePage logsWorkspace">
        {ros.lastError && <div className="errorLine">{ros.lastError}</div>}
        <EventLog log={state.log} t={t} />
        <TelemetryBar telemetry={state.telemetry} t={t} />
      </section>
    );
  }

  return (
    <main className="app">
      <section className="controlHeader">
        <TopBar rosState={ros.state} theme={state.theme} onToggleTheme={toggleTheme} lang={lang} onToggleLang={toggleLang} gamepadConnected={gamepad.connected} t={t} />

        <ConnectionPanel
          url={ros.url} onUrlChange={ros.setUrl}
          imuTopic={state.imuTopic} onImuTopicChange={(v) => dispatch({ type: 'SET_IMU_TOPIC', value: v })}
          onConnect={ros.connect} onDisconnect={ros.disconnect}
          onEstop={estop} onRelease={() => estop(false)}
          rosState={ros.state} t={t}
        />

        <MetricsBar
          controlStatus={state.controlStatus}
          cruiseActive={state.cruiseStatus.active}
          collectionState={state.collection.status.state}
          collectionCollecting={state.collection.status.collecting}
          voltage={state.telemetry.voltage}
          imuZ={state.telemetry.imuZ}
          heading={state.telemetry.heading}
          headingSource={state.telemetry.headingSource}
          t={t}
        />
      </section>

      <nav className="workspaceTabs" aria-label="workspace tabs">
        {workspaceTabs.map((tab) => (
          <button
            key={tab.id}
            className={state.activeWorkspaceTab === tab.id ? 'active' : 'ghost'}
            onClick={() => dispatch({ type: 'SET_WORKSPACE_TAB', value: tab.id })}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {state.activeWorkspaceTab === 'drive' && renderDriveWorkspace()}
      {state.activeWorkspaceTab === 'experiment' && renderExperimentWorkspace()}
      {state.activeWorkspaceTab === 'analysis' && renderAnalysisWorkspace()}
      {state.activeWorkspaceTab === 'logs' && renderLogsWorkspace()}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
