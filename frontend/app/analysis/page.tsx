'use client';

import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Activity, Info, Database, Settings, FlaskConical } from 'lucide-react';
import { getModelInfo, type ModelInfo } from '../lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(v: number, digits = 2) {
  return (v * 100).toFixed(digits) + '%';
}
function fmtN(v: number | undefined | null, digits = 4): string {
  if (v == null) return '—';
  return (v * 100).toFixed(digits) + '%';
}
function fmtNum(v: number | string | undefined | null): string {
  if (v == null || v === '') return '—';
  return String(v);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({ icon: Icon, title, badge }: {
  icon: React.ElementType; title: string; badge?: string;
}) {
  return (
    <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
      <Icon size={18} className="text-[var(--color-primary-light)]" />
      {title}
      {badge && (
        <span className="ml-auto text-[10px] font-normal px-2 py-0.5 rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
          {badge}
        </span>
      )}
    </h2>
  );
}

function InfoRow({ label, value, highlight, mono }: {
  label: string; value: string; highlight?: boolean; mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-center p-2.5 rounded-lg odd:bg-[var(--color-bg-elevated)]">
      <span className="text-[var(--color-text-muted)] shrink-0 text-sm">{label}</span>
      <span
        className={`text-right max-w-[58%] truncate ml-2 text-sm font-medium
          ${highlight ? 'text-[var(--color-primary-light)]' : 'text-white'}
          ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function MetricBar({ label, value, color, secondary }: {
  label: string; value: number | null; color: string; secondary?: string;
}) {
  const pct = Math.min((value ?? 0) * 100, 100);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <div className="text-right">
          <span className="font-mono font-medium" style={{ color }}>
            {value != null ? pct.toFixed(2) + '%' : '—'}
          </span>
          {secondary && (
            <span className="text-[10px] text-[var(--color-text-muted)] ml-2">{secondary}</span>
          )}
        </div>
      </div>
      <div className="w-full h-2 rounded-full bg-[var(--color-border)]">
        <div className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-1.5">
      {[...Array(n)].map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AnalysisPage() {
  const [info, setInfo]   = useState<ModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getModelInfo()
      .then(setInfo)
      .catch(e => setError(e instanceof Error ? e.message : 'Gagal memuat info model'));
  }, []);

  // ── Shorthand ke sub-objek metadata ──────────────────────────────────────
  const mp    = (info as any)?.model_parameters;          // parameter RF lengkap
  const hs    = (info as any)?.hyperparameter_search;     // hasil tuning HP
  const vm    = (info as any)?.validation_metrics_before_threshold_tuning;
  const tt    = (info as any)?.threshold_tuning;          // threshold_tuning.*
  const tm    = tt?.validation_metrics;                   // metrik di threshold terpilih
  const testM = tt?.test_metrics;                         // metrik di testing set
  const ds    = (info as any)?.data_statistics;           // data_statistics.*
  const lv    = info?.library_versions;
  const rt    = (info as any)?.runtime;
  const features = info?.feature_names ?? [];

  // class_weight dari model_parameters (object atau string)
  const cwRaw = mp?.class_weight;
  const classWeightStr = cwRaw == null ? '—'
    : typeof cwRaw === 'object' ? JSON.stringify(cwRaw)  // {0:1, 1:10}
    : String(cwRaw);

  // Positive rate dataset (backorder %)
  const posRate = ds?.positive_rate != null
    ? `${(ds.positive_rate * 100).toFixed(3)}%`
    : '—';

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">Analisis Model</h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">
          Detail performa, konfigurasi, dan statistik model ML terbaru.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 glass-card p-4 border border-red-500/20 bg-red-500/5 animate-fade-in-up">
          <p className="text-sm text-red-400">⚠ {error}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Pastikan backend dan Flask service sedang berjalan.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── 1. Informasi Model ───────────────────────────────────────────── */}
        <div className="glass-card p-6 animate-fade-in-up">
          <SectionHeader icon={Activity} title="Informasi Model" />
          {info ? (
            <div className="space-y-1 text-sm">
              <InfoRow label="Tipe Model"       value="sklearn Pipeline + RF Classifier" />
              <InfoRow label="Tanggal Training"  value={new Date(info.trained_at).toLocaleString('id-ID')} />
              <InfoRow label="Threshold Optimal" value={fmt(info.optimal_threshold, 2)} highlight />
              <InfoRow label="Status Threshold"  value={info.threshold_status ?? '—'} highlight />
              <InfoRow label="Strategi Tuning"   value={tt?.strategy ?? '—'} />
              <InfoRow label="Beta (Fβ)"         value={tt?.beta != null ? String(tt.beta) : '—'} mono />
              <InfoRow label="Imbalance Strategy" value="class_weight + threshold tuning" />
              <InfoRow label="class_weight"      value={classWeightStr} mono />
            </div>
          ) : !error ? <SkeletonRows n={8} /> : null}
        </div>

        {/* ── 2. Parameter Model ──────────────────────────────────────────── */}
        <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
          <SectionHeader icon={Settings} title="Parameter Model" badge="RandomForestClassifier" />
          {info ? (
            <div className="space-y-1 text-sm">
              <InfoRow label="n_estimators"       value={fmtNum(mp?.n_estimators)} mono />
              <InfoRow label="max_depth"          value={fmtNum(mp?.max_depth ?? 'None')} mono />
              <InfoRow label="max_features"       value={fmtNum(mp?.max_features)} mono />
              <InfoRow label="max_samples"        value={fmtNum(mp?.max_samples)} mono />
              <InfoRow label="min_samples_split"  value={fmtNum(mp?.min_samples_split)} mono />
              <InfoRow label="min_samples_leaf"   value={fmtNum(mp?.min_samples_leaf)} mono />
              <InfoRow label="criterion"          value={fmtNum(mp?.criterion)} mono />
              <InfoRow label="bootstrap"          value={mp?.bootstrap ? 'Ya' : 'Tidak'} />
            </div>
          ) : !error ? <SkeletonRows n={8} /> : null}
        </div>

        {/* ── 3. Statistik Dataset ────────────────────────────────────────── */}
        <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <SectionHeader icon={Database} title="Statistik Dataset" />
          {info ? (
            <div className="space-y-1 text-sm">
              <InfoRow label="Total Data Dimuat"    value={ds?.rows_loaded != null ? ds.rows_loaded.toLocaleString('id-ID') : '—'} />
              <InfoRow label="Data Siap Training"   value={ds?.rows_ready  != null ? ds.rows_ready.toLocaleString('id-ID')  : '—'} />
              <InfoRow label="Fit Rows"             value={(info as any)?.fit_rows != null ? (info as any).fit_rows.toLocaleString('id-ID') : '—'} />
              <InfoRow label="Validation Rows"      value={(info as any)?.validation_rows != null ? (info as any).validation_rows.toLocaleString('id-ID') : '—'} />
              <InfoRow label="Kelas 0 (Aman)"       value={ds?.class_distribution?.['0'] != null ? Number(ds.class_distribution['0']).toLocaleString('id-ID') : '—'} />
              <InfoRow label="Kelas 1 (Backorder)"  value={ds?.class_distribution?.['1'] != null ? Number(ds.class_distribution['1']).toLocaleString('id-ID') : '—'} />
              <InfoRow label="Positive Rate"        value={posRate} highlight />
              <InfoRow label="Sentinel Replaced (perf_6m)"  value={ds?.sentinel_replaced?.perf_6_month_avg  != null ? Number(ds.sentinel_replaced.perf_6_month_avg).toLocaleString('id-ID') : '—'} />
            </div>
          ) : !error ? <SkeletonRows n={8} /> : null}
        </div>

        {/* ── 4. Hyperparameter Search ─────────────────────────────────────── */}
        <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '0.15s' }}>
          <SectionHeader
            icon={FlaskConical}
            title="Hyperparameter Search"
            badge={hs?.enabled ? `${hs?.n_iter ?? '?'} iterasi · CV ${hs?.cv_splits ?? '?'}` : 'Dinonaktifkan'}
          />
          {info ? (
            <div className="space-y-1 text-sm">
              <InfoRow label="Enabled"              value={hs?.enabled ? 'Ya' : 'Tidak'} />
              <InfoRow label="Scoring (refit)"      value={hs?.scoring_refit ?? '—'} mono />
              <InfoRow label="Best CV Avg Precision" value={hs?.best_cv_average_precision != null ? fmtN(hs.best_cv_average_precision, 4) : '—'} highlight />
              <InfoRow label="Sample Rows"          value={hs?.sample_rows != null ? Number(hs.sample_rows).toLocaleString('id-ID') : '—'} />
              <InfoRow label="n_iter"               value={fmtNum(hs?.n_iter)} mono />
              <InfoRow label="CV Splits"            value={fmtNum(hs?.cv_splits)} mono />
              <InfoRow label="Runtime Platform"     value={rt?.platform?.split('-').slice(0,2).join(' ') ?? '—'} />
              <InfoRow label="CPU Cores"            value={fmtNum(rt?.cpu_count)} mono />
            </div>
          ) : !error ? <SkeletonRows n={8} /> : null}
        </div>

        {/* ── 5. Metrik Evaluasi (3 kolom) ────────────────────────────────── */}
        <div className="glass-card p-6 lg:col-span-2 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <SectionHeader icon={TrendingUp} title="Metrik Evaluasi" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Kolom A — Validation @ threshold=0.5 */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                Validation · t=0.50 (default)
              </p>
              <div className="space-y-3">
                <MetricBar label="Avg Precision"  value={vm?.average_precision ?? null} color="#a78bfa" />
                <MetricBar label="ROC-AUC"        value={vm?.roc_auc ?? null}           color="#ec4899" />
                <MetricBar label="Accuracy"       value={vm?.accuracy ?? null}          color="#6366f1" />
                <MetricBar label="Precision"      value={vm?.precision ?? null}         color="#06b6d4" />
                <MetricBar label="Recall"         value={vm?.recall ?? null}            color="#10b981" />
                <MetricBar label="F1"             value={vm?.f1 ?? null}                color="#f59e0b" />
              </div>
            </div>

            {/* Kolom B — Validation @ threshold terpilih */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                Validation · t={info ? fmt(info.optimal_threshold, 2) : '…'} (tuned)
              </p>
              <div className="space-y-3">
                <MetricBar label="Avg Precision"  value={tm?.average_precision ?? null} color="#a78bfa" />
                <MetricBar label="ROC-AUC"        value={tm?.roc_auc ?? null}           color="#ec4899" />
                <MetricBar label="Accuracy"       value={tm?.accuracy ?? null}          color="#6366f1" />
                <MetricBar label="Precision"      value={tm?.precision ?? null}         color="#06b6d4" />
                <MetricBar label="Recall"         value={tm?.recall ?? null}            color="#10b981" />
                <MetricBar label="F1"             value={tm?.f1 ?? null}                color="#f59e0b" />
              </div>
            </div>

            {/* Kolom C — Test set @ threshold terpilih */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                Testing Set · t={info ? fmt(info.optimal_threshold, 2) : '…'}
              </p>
              {testM ? (
                <div className="space-y-3">
                  <MetricBar label="Avg Precision"  value={testM.average_precision ?? null} color="#a78bfa" />
                  <MetricBar label="ROC-AUC"        value={testM.roc_auc ?? null}           color="#ec4899" />
                  <MetricBar label="Accuracy"       value={testM.accuracy ?? null}          color="#6366f1" />
                  <MetricBar label="Precision"      value={testM.precision ?? null}         color="#06b6d4" />
                  <MetricBar label="Recall"         value={testM.recall ?? null}            color="#10b981" />
                  <MetricBar label="F1"             value={testM.f1 ?? null}                color="#f59e0b" />
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-[var(--color-bg-elevated)]">
                  <Info size={14} className="text-[var(--color-text-muted)] mt-0.5 shrink-0" />
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Evaluasi test set belum dijalankan. Tambahkan{' '}
                    <code className="px-1 rounded bg-[var(--color-bg-card)] text-[var(--color-primary-light)]">
                      --test Testing_BOP.csv
                    </code>{' '}
                    saat menjalankan <code className="px-1 rounded bg-[var(--color-bg-card)] text-[var(--color-primary-light)]">threshold_tuning.py</code>.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Confusion matrix ringkas di bawah kolom */}
          {tm && (
            <div className="mt-6 pt-5 border-t border-[var(--color-border)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                Confusion Matrix — Validation @ threshold terpilih
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'True Positive',  value: tm.confusion_matrix?.tp, color: '#10b981', desc: 'Backorder terdeteksi' },
                  { label: 'True Negative',  value: tm.confusion_matrix?.tn, color: '#6366f1', desc: 'Aman terdeteksi' },
                  { label: 'False Positive', value: tm.confusion_matrix?.fp, color: '#f59e0b', desc: 'False alarm' },
                  { label: 'False Negative', value: tm.confusion_matrix?.fn, color: '#ef4444', desc: 'Backorder terlewat ⚠' },
                ].map(c => (
                  <div key={c.label} className="p-3 rounded-xl bg-[var(--color-bg-elevated)] text-center">
                    <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wide">{c.label}</p>
                    <p className="text-xl font-bold mt-1" style={{ color: c.color }}>
                      {c.value != null ? Number(c.value).toLocaleString('id-ID') : '—'}
                    </p>
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{c.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 6. Fitur Model ──────────────────────────────────────────────── */}
        <div className="glass-card p-6 lg:col-span-2 animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
          <SectionHeader icon={BarChart3} title={`Fitur Model (${features.length})`} />
          <div className="flex flex-wrap gap-2">
            {features.length > 0 ? features.map((f, i) => {
              const isNumeric = (info as any)?.numeric_features?.includes(f);
              const isBinary  = (info as any)?.binary_features?.includes(f);
              return (
                <span
                  key={f}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono"
                  style={{
                    background: isNumeric ? '#6366f115' : isBinary ? '#10b98115' : '#ffffff10',
                    color: isNumeric ? '#a5b4fc' : isBinary ? '#6ee7b7' : 'white',
                    border: `1px solid ${isNumeric ? '#6366f130' : isBinary ? '#10b98130' : '#ffffff20'}`,
                  }}
                  title={isNumeric ? 'Numerik' : isBinary ? 'Biner (Yes/No)' : 'Lainnya'}
                >
                  <span className="opacity-50 text-[10px]">{i + 1}.</span>
                  {f}
                  <span className="opacity-40 text-[9px]">{isNumeric ? 'num' : 'bin'}</span>
                </span>
              );
            }) : !error ? (
              <div className="flex flex-wrap gap-2">
                {[...Array(21)].map((_, i) => (
                  <div key={i} className="h-8 w-32 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse" />
                ))}
              </div>
            ) : null}
          </div>
          {features.length > 0 && (
            <div className="mt-4 flex items-center gap-4 text-[10px] text-[var(--color-text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-400/30 border border-indigo-400/40" />
                Numerik (imputasi median)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400/30 border border-emerald-400/40" />
                Biner Yes/No (OHE)
              </span>
            </div>
          )}
        </div>

        {/* ── 7. Library Versions ──────────────────────────────────────────── */}
        {lv && (
          <div className="glass-card p-6 lg:col-span-2 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
            <SectionHeader icon={Info} title="Versi Library" />
            <div className="flex flex-wrap gap-3">
              {Object.entries(lv).map(([lib, ver]) => (
                <div key={lib} className="px-3 py-2 rounded-lg bg-[var(--color-bg-elevated)] text-xs">
                  <span className="text-[var(--color-text-muted)]">{lib}</span>
                  <span className="ml-2 font-mono text-[var(--color-primary-light)] font-medium">{ver}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
