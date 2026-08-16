import React, { useMemo } from 'react';
import { FlaskConical, Play, TimerReset } from 'lucide-react';

const FAULT_OPTIONS = [
  { value: 'normal', labelKey: 'normalMode', faultLabel: 0 },
  { value: 'drive_abnormal', labelKey: 'driveAbnormal', faultLabel: 1 },
  { value: 'wheel_slip', labelKey: 'wheelSlip', faultLabel: 2 },
  { value: 'shaft_eccentric', labelKey: 'shaftEccentric', faultLabel: 3 },
];

function SectionTitle({ icon: Icon, title, detail }) {
  return (
    <div className="sectionTitle">
      <div><Icon size={18}/><strong>{title}</strong></div>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export default function ExperimentWizard({ experiment, collection, onFieldChange, onStart, onReset, t }) {
  const selectedFault = useMemo(
    () => FAULT_OPTIONS.find((item) => item.value === experiment.faultType) || FAULT_OPTIONS[0],
    [experiment.faultType],
  );
  const runPreview = experiment.runId || `${experiment.faultType}_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;

  function setWheel(wheel, checked) {
    onFieldChange('wheels', { ...experiment.wheels, [wheel]: checked });
  }

  function setAlpha(wheel, value) {
    onFieldChange('alpha', { ...experiment.alpha, [wheel]: value });
  }

  return (
    <section className="panel wizardPanel">
      <SectionTitle icon={FlaskConical} title={t('experimentWizard')} detail={t('experimentWizardHint')} />
      <div className="wizardSteps">
        <span className="active">1 {t('experimentConfig')}</span>
        <span>2 {t('faultSetup')}</span>
        <span>3 {t('oneClickRun')}</span>
      </div>

      <div className="formGrid compactForm">
        <label>
          <span>{t('faultType')}</span>
          <select value={experiment.faultType} onChange={(e) => onFieldChange('faultType', e.target.value)}>
            {FAULT_OPTIONS.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
          </select>
        </label>
        <label>
          <span>{t('runId')}</span>
          <input value={experiment.runId} placeholder={runPreview} onChange={(e) => onFieldChange('runId', e.target.value)} />
        </label>
        <label>
          <span>{t('autoStopDuration')}</span>
          <input type="number" min="0" step="10" value={experiment.durationSec} onChange={(e) => onFieldChange('durationSec', e.target.value)} />
        </label>
        <label>
          <span>{t('motionMode')}</span>
          <input value={experiment.motionMode} onChange={(e) => onFieldChange('motionMode', e.target.value)} />
        </label>
        <label>
          <span>{t('expectedRate')}</span>
          <input type="number" min="1" step="0.1" value={experiment.expectedRate} onChange={(e) => onFieldChange('expectedRate', e.target.value)} />
        </label>
        <label>
          <span>{t('outputDir')}</span>
          <input value={collection.outputDir} onChange={(e) => onFieldChange('outputDir', e.target.value)} />
        </label>
      </div>

      <div className="wheelMatrix">
        {['A', 'B', 'C'].map((wheel) => (
          <label key={wheel} className={experiment.wheels?.[wheel] ? 'selected' : ''}>
            <span>{t('faultWheel')} {wheel}</span>
            <input type="checkbox" checked={Boolean(experiment.wheels?.[wheel])} onChange={(e) => setWheel(wheel, e.target.checked)} />
            <input type="number" min="0" max="1" step="0.05" value={experiment.alpha?.[wheel] ?? 1} onChange={(e) => setAlpha(wheel, e.target.value)} />
          </label>
        ))}
      </div>

      <div className="wizardSummary">
        <strong>{t('experimentReady')}</strong>
        <span>{t(selectedFault.labelKey)} / {runPreview} / {collection.currentPort}</span>
      </div>

      <div className="actions">
        <button onClick={onStart}><Play size={16}/>{t('startExperiment')}</button>
        <button className="ghost" onClick={onReset}><TimerReset size={16}/>{t('resetWizard')}</button>
      </div>
    </section>
  );
}
