'use client';

import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Activity, Info } from 'lucide-react';
import { getModelInfo, type ModelInfo } from '../lib/api';

export default function AnalysisPage() {
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getModelInfo()
      .then(setInfo)
      .catch(e => setError(e instanceof Error ? e.message : 'Gagal memuat info model'));
  }, []);

  const features = info?.feature_names || [];
  const metrics  = info?.evaluation_metrics;

  // Baris informasi model — handle schema lama DAN baru
  // Nama model — singkat untuk tampilan, simpan nama lengkap untuk tooltip
  const rawModelName = info?.model_class ?? info?.model_type?.match(/\(([^)]+)\)$/)?.[1] ?? info?.model_type;
  const shortModelName = rawModelName
    ?.replace('RandomForestClassifier', 'RF Classifier')
    ?.replace('RandomForest', 'RF') ?? '—';

  const infoRows: [string, string, string?][] = info ? [
    ['Tipe Model',        shortModelName,    rawModelName],
    ['Tanggal Training',  info.trained_at ? new Date(info.trained_at).toLocaleString('id-ID') : '—'],
    // smote_applied tidak ada di schema baru (pipeline sklearn menggantikan SMOTE)
    ['SMOTE',             info.smote_applied != null ? (info.smote_applied ? 'Ya' : 'Tidak') : 'Tidak'],
    ['Threshold Optimal', `${(info.optimal_threshold * 100).toFixed(2)}%`],
    ['Status Threshold',  info.threshold_status ?? '—'],
    ['n_estimators',      String((info.parameters ?? info.model_parameters)?.n_estimators ?? '—')],
    ['max_depth',         String((info.parameters ?? info.model_parameters)?.max_depth ?? 'None')],
    ['class_weight',      String((info.parameters ?? info.model_parameters)?.class_weight ?? '—')],
    ['Python',            info.library_versions?.python ?? '—'],
    ['scikit-learn',      info.library_versions?.scikit_learn ?? '—'],
  ] : [];

  const metricsRows: [string, number, string][] = metrics ? [
    ['Accuracy',          metrics.accuracy,   '#6366f1'],
    ['Precision',         metrics.precision,  '#06b6d4'],
    ['Recall',            metrics.recall,     '#10b981'],
    ['F1-Score',          metrics.f1_score,   '#f59e0b'],
    ['ROC-AUC',           metrics.roc_auc ?? 0, '#ec4899'],
    ...(metrics.average_precision != null
      ? [['Avg Precision', metrics.average_precision, '#a78bfa'] as [string, number, string]]
      : []),
  ] : [];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">Analisis Model</h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Detail performa dan konfigurasi model ML.</p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 glass-card p-4 border border-red-500/20 bg-red-500/5 animate-fade-in-up">
          <p className="text-sm text-red-400">⚠ Gagal memuat info model: {error}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            Pastikan backend dan Flask service sedang berjalan.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model info card */}
        <div className="glass-card p-6 animate-fade-in-up">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Activity size={18} className="text-[var(--color-primary-light)]" />
            Informasi Model
          </h2>
          {info ? (
            <div className="space-y-1 text-sm">
              {infoRows.map(([k, v, tooltip]) => (
                <div key={k} className="flex justify-between items-center p-2.5 rounded-lg odd:bg-[var(--color-bg-elevated)]">
                  <span className="text-[var(--color-text-muted)] shrink-0">{k}</span>
                  <span className="font-medium text-white text-right max-w-[55%] truncate ml-2" title={tooltip ?? v}>{v}</span>
                </div>
              ))}
            </div>
          ) : !error ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-9 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse" />
              ))}
            </div>
          ) : null}
        </div>

        {/* Metrics card */}
        <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-[var(--color-primary-light)]" />
            Metrik Evaluasi
            {info?.validation_metrics_before_threshold_tuning && (
              <span className="ml-auto text-[10px] font-normal px-2 py-0.5 rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-text-muted)]">
                sebelum threshold tuning
              </span>
            )}
          </h2>
          {metricsRows.length > 0 ? (
            <div className="space-y-4">
              {metricsRows.map(([label, val, color]) => (
                <div key={label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--color-text-muted)]">{label}</span>
                    <span className="font-mono font-medium" style={{ color }}>
                      {(val * 100).toFixed(2)}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[var(--color-border)]">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(val * 100, 100)}%`, background: color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : !error ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i}>
                  <div className="flex justify-between mb-1">
                    <div className="h-4 w-20 rounded bg-[var(--color-bg-elevated)] animate-pulse" />
                    <div className="h-4 w-14 rounded bg-[var(--color-bg-elevated)] animate-pulse" />
                  </div>
                  <div className="h-2 rounded-full bg-[var(--color-bg-elevated)] animate-pulse" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-[var(--color-bg-elevated)]">
              <Info size={16} className="text-[var(--color-text-muted)]" />
              <p className="text-xs text-[var(--color-text-muted)]">
                Metrik tidak dapat dimuat. Coba refresh halaman.
              </p>
            </div>
          )}
        </div>

        {/* Feature list */}
        <div className="glass-card p-6 lg:col-span-2 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-[var(--color-primary-light)]" />
            Fitur Model ({features.length})
          </h2>
          {features.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {features.map((f, i) => (
                <div key={f} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-bg-elevated)] text-sm">
                  <span className="text-xs text-[var(--color-text-muted)] font-mono w-5">{i + 1}.</span>
                  <span className="text-white font-mono text-xs">{f}</span>
                </div>
              ))}
            </div>
          ) : !error ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {[...Array(21)].map((_, i) => (
                <div key={i} className="h-8 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse" />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
