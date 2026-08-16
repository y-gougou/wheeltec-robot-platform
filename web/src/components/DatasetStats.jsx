import React from 'react';
import { BarChart3, Database, RefreshCw } from 'lucide-react';

function SectionTitle({ icon: Icon, title, detail }) {
  return (
    <div className="sectionTitle">
      <div><Icon size={18}/><strong>{title}</strong></div>
      {detail && <span>{detail}</span>}
    </div>
  );
}

function Stat({ label, value }) {
  return <div className="statCell"><span>{label}</span><strong>{value}</strong></div>;
}

function formatDuration(value) {
  const seconds = Number(value || 0);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${(seconds / 60).toFixed(1)}min`;
}

export default function DatasetStats({ summary, dataset, onRefresh, t }) {
  const classes = summary?.classes || [];
  const totalRows = summary?.total_rows || 0;
  const buildResult = dataset?.buildResult;

  return (
    <section className="panel datasetStatsPanel">
      <SectionTitle icon={BarChart3} title={t('datasetStats')} detail={t('datasetStatsHint')} />
      <div className="statsHeader">
        <Stat label={t('csvFiles')} value={summary?.file_count || 0} />
        <Stat label={t('totalRows')} value={totalRows} />
        <Stat label={t('totalDuration')} value={formatDuration(summary?.total_duration_sec)} />
        <button className="ghost" onClick={onRefresh}><RefreshCw size={15}/>{t('refresh')}</button>
      </div>

      <div className="classTable">
        <div className="classRow header">
          <span>{t('faultType')}</span>
          <span>{t('csvFiles')}</span>
          <span>{t('runs')}</span>
          <span>{t('rows')}</span>
          <span>{t('duration')}</span>
        </div>
        {classes.length === 0 ? (
          <div className="tableEmpty"><Database size={16}/>{t('noDatasetStats')}</div>
        ) : classes.map((item) => (
          <div className="classRow" key={`${item.fault_label}-${item.fault_name}`}>
            <span>{item.fault_label} / {item.fault_name}</span>
            <span>{item.files}</span>
            <span>{item.runs}</span>
            <span>{item.rows}</span>
            <span>{formatDuration(item.duration_sec)}</span>
          </div>
        ))}
      </div>

      {buildResult && (
        <div className="buildSnapshot">
          <strong>{t('latestBuild')}</strong>
          <span>{buildResult.feature_set} / {buildResult.train_samples}+{buildResult.test_samples} / {buildResult.split_method}</span>
        </div>
      )}
    </section>
  );
}
