import React, { useMemo, useState } from 'react';
import { Activity, Eye, EyeOff, FileSearch, LineChart as LineChartIcon, RefreshCw } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const LIVE_LINES = [
  { key: 'c0', name: 'current A', color: '#12a7b8' },
  { key: 'c1', name: 'current B', color: '#7cba3d' },
  { key: 'c2', name: 'current C', color: '#f2a541' },
  { key: 'voltage', name: 'voltage', color: '#d65f5f' },
  { key: 'vx', name: 'vx', color: '#4f8cff' },
  { key: 'vy', name: 'vy', color: '#9b7cff' },
  { key: 'wz', name: 'wz', color: '#e26ac0' },
  { key: 'imuZ', name: 'imu gz', color: '#8aa0ad' },
];

const CSV_LINES = [
  { key: 'current0', name: 'current0', color: '#12a7b8' },
  { key: 'current1', name: 'current1', color: '#7cba3d' },
  { key: 'current2', name: 'current2', color: '#f2a541' },
  { key: 'voltage', name: 'voltage', color: '#d65f5f' },
  { key: 'odom_vx', name: 'odom vx', color: '#4f8cff' },
  { key: 'odom_vy', name: 'odom vy', color: '#9b7cff' },
  { key: 'odom_wz', name: 'odom wz', color: '#e26ac0' },
  { key: 'imu_gz', name: 'imu gz', color: '#8aa0ad' },
];

function SectionTitle({ icon: Icon, title, detail }) {
  return (
    <div className="sectionTitle">
      <div><Icon size={18}/><strong>{title}</strong></div>
      {detail && <span>{detail}</span>}
    </div>
  );
}

function ChartBlock({ data, lines, emptyText }) {
  const visibleLines = lines.filter((line) => line.visible !== false);
  if (!data || data.length === 0) {
    return <div className="chartEmpty">{emptyText}</div>;
  }
  return (
    <div className="chartBox">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 10, right: 18, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
          <XAxis dataKey="t" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} width={52} />
          <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {visibleLines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SeriesControls({ lines, onToggle, onNameChange, t }) {
  return (
    <div className="seriesControls">
      {lines.map((line) => (
        <label key={line.key} className={line.visible === false ? 'mutedSeries' : ''}>
          <button type="button" className="iconToggle" onClick={() => onToggle(line.key)} title={line.visible === false ? t('showSeries') : t('hideSeries')}>
            {line.visible === false ? <EyeOff size={14}/> : <Eye size={14}/>}
          </button>
          <span className="seriesDot" style={{ background: line.color }} />
          <input value={line.name} onChange={(e) => onNameChange(line.key, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

export default function DataVisualization({ liveData, preview, previewLoading, previewError, selectedFile, onRefreshPreview, t }) {
  const [tab, setTab] = useState('live');
  const [settingsTab, setSettingsTab] = useState('chart');
  const [liveLines, setLiveLines] = useState(LIVE_LINES.map((line) => ({ ...line, visible: true })));
  const [csvLines, setCsvLines] = useState(CSV_LINES.map((line) => ({ ...line, visible: true })));
  const previewRows = useMemo(() => {
    if (!preview?.rows) return [];
    return preview.rows.map((row, index) => ({
      ...row,
      t: row.timestamp !== undefined && row.timestamp !== null ? Number(row.timestamp).toFixed(1) : index,
    }));
  }, [preview]);

  function updateLines(kind, updater) {
    if (kind === 'live') setLiveLines((prev) => prev.map(updater));
    else setCsvLines((prev) => prev.map(updater));
  }

  function toggleSeries(kind, key) {
    updateLines(kind, (line) => (line.key === key ? { ...line, visible: line.visible === false } : line));
  }

  function renameSeries(kind, key, name) {
    updateLines(kind, (line) => (line.key === key ? { ...line, name } : line));
  }

  return (
    <section className="panel visualizationPanel">
      <SectionTitle icon={LineChartIcon} title={t('dataVisualization')} detail={t('visualizationHint')} />
      <div className="chartTabs">
        <button className={tab === 'live' ? 'active' : 'ghost'} onClick={() => setTab('live')}><Activity size={15}/>{t('liveMonitor')}</button>
        <button className={tab === 'csv' ? 'active' : 'ghost'} onClick={() => setTab('csv')}><FileSearch size={15}/>{t('csvPreview')}</button>
        <button className={settingsTab === 'chart' ? 'active' : 'ghost'} onClick={() => setSettingsTab('chart')}>{t('chartView')}</button>
        <button className={settingsTab === 'series' ? 'active' : 'ghost'} onClick={() => setSettingsTab('series')}>{t('seriesSettings')}</button>
      </div>

      {tab === 'live' && (
        <>
          {settingsTab === 'series' ? (
            <SeriesControls
              lines={liveLines}
              onToggle={(key) => toggleSeries('live', key)}
              onNameChange={(key, name) => renameSeries('live', key, name)}
              t={t}
            />
          ) : (
            <ChartBlock data={liveData} lines={liveLines} emptyText={t('noLiveData')} />
          )}
        </>
      )}

      {tab === 'csv' && (
        <>
          <div className="previewHeader">
            <div>
              <strong>{selectedFile || t('noFileSelected')}</strong>
              {preview && <span>{preview.row_count} {t('rows')} / {preview.sampled_points} {t('sampledPoints')}</span>}
            </div>
            <button className="ghost" onClick={onRefreshPreview} disabled={!selectedFile || previewLoading}>
              <RefreshCw size={15}/>{previewLoading ? t('loading') : t('refresh')}
            </button>
          </div>
          {previewError && <div className="errorLine">{previewError}</div>}
          {settingsTab === 'series' ? (
            <SeriesControls
              lines={csvLines}
              onToggle={(key) => toggleSeries('csv', key)}
              onNameChange={(key, name) => renameSeries('csv', key, name)}
              t={t}
            />
          ) : (
            <ChartBlock data={previewRows} lines={csvLines} emptyText={selectedFile ? t('noPreviewData') : t('selectCsvToPreview')} />
          )}
        </>
      )}
    </section>
  );
}
