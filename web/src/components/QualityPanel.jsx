import React, { useMemo } from 'react';
import { RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';

function SectionTitle({ icon: Icon, title, detail }) {
  return (
    <div className="sectionTitle">
      <div><Icon size={18}/><strong>{title}</strong></div>
      {detail && <span>{detail}</span>}
    </div>
  );
}

function Pill({ label, value, tone = '' }) {
  return (
    <div className={`qualityPill ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function QualityPanel({ collection, quality, onCurrentPortChange, onReconnectCurrent, t }) {
  const status = collection.status || {};
  const current = collection.current || {};
  const reasons = useMemo(() => quality?.reasons || [], [quality]);
  const tone = quality?.level === 'good' ? 'good' : quality?.level === 'bad' ? 'bad' : 'warn';

  return (
    <section className="panel qualityPanel">
      <SectionTitle icon={ShieldCheck} title={t('qualityPanel')} detail={t('qualityHint')} />
      <div className={`qualityBanner ${tone}`}>
        <div>
          <strong>{t(`quality_${quality?.level || 'warn'}`)}</strong>
          <span>{reasons.length ? reasons.join(' / ') : t('qualityLooksStable')}</span>
        </div>
        <TriangleAlert size={20}/>
      </div>
      <div className="qualityGrid">
        <Pill label={t('state')} value={status.state || 'idle'} tone={status.collecting ? 'good' : ''} />
        <Pill label={t('rows')} value={status.sample_id || 0} />
        <Pill label={t('estimatedRate')} value={`${quality?.estimatedRate || '0.0'} Hz`} tone={quality?.rateTone || ''} />
        <Pill label={t('rateDrift')} value={`${quality?.rateDrift || '0'}%`} tone={quality?.rateTone || ''} />
        <label className={`qualityPill editablePort ${current.connected ? 'good' : 'bad'}`}>
          <span>{t('currentPort')}</span>
          <div>
            <input value={collection.currentPort} onChange={(e) => onCurrentPortChange(e.target.value)} />
            <button type="button" onClick={onReconnectCurrent} title={t('reconnectCurrent')}><RefreshCw size={14}/></button>
          </div>
        </label>
        <Pill label={t('currentAge')} value={current.last_current_age == null ? '--' : `${Number(current.last_current_age).toFixed(2)}s`} tone={quality?.currentTone || ''} />
        <Pill label={t('currentFrames')} value={current.valid_total || 0} />
        <Pill label={t('runDuration')} value={`${quality?.durationSec || 0}s`} />
      </div>
    </section>
  );
}
