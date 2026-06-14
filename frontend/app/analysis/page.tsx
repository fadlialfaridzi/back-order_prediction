'use client';

import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Activity } from 'lucide-react';
import { getModelInfo, type ModelInfo } from '../lib/api';

export default function AnalysisPage() {
  const [info, setInfo] = useState<ModelInfo | null>(null);

  useEffect(() => {
    getModelInfo().then(setInfo).catch(() => {});
  }, []);

  const features = info?.feature_names || [];
  const metrics = info?.evaluation_metrics;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">Analisis Model</h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">Detail performa dan konfigurasi model ML.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Model info card */}
        <div className="glass-card p-6 animate-fade-in-up">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Activity size={18} className="text-[var(--color-primary-light)]" />
            Informasi Model
          </h2>
          {info ? (
            <div className="space-y-3 text-sm">
              {([
                ['Kelas Model', info.model_class],
                ['Tanggal Training', new Date(info.trained_at).toLocaleString('id-ID')],
                ['SMOTE', info.smote_applied ? 'Ya' : 'Tidak'],
                ['Threshold Optimal', `${(info.optimal_threshold * 100).toFixed(0)}%`],
                ['Tuned At', info.threshold_tuned_at ? new Date(info.threshold_tuned_at).toLocaleString('id-ID') : '—'],
                ['n_estimators', String(info.parameters?.n_estimators ?? '—')],
                ['max_depth', String(info.parameters?.max_depth ?? 'None')],
                ['class_weight', String(info.parameters?.class_weight ?? '—')],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between p-2 rounded-lg odd:bg-[var(--color-bg-elevated)]">
                  <span className="text-[var(--color-text-muted)]">{k}</span>
                  <span className="font-medium text-white">{v}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[var(--color-text-muted)] text-sm">Memuat...</p>
          )}
        </div>

        {/* Metrics card */}
        <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '0.05s' }}>
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-[var(--color-primary-light)]" />
            Metrik Evaluasi
          </h2>
          {metrics ? (
            <div className="space-y-4">
              {([
                ['Accuracy', metrics.accuracy, '#6366f1'],
                ['Precision', metrics.precision, '#06b6d4'],
                ['Recall', metrics.recall, '#10b981'],
                ['F1-Score', metrics.f1_score, '#f59e0b'],
                ['ROC-AUC', metrics.roc_auc, '#ec4899'],
              ] as [string, number, string][]).map(([label, val, color]) => (
                <div key={label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--color-text-muted)]">{label}</span>
                    <span className="font-mono font-medium" style={{ color }}>{(val * 100).toFixed(2)}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[var(--color-border)]">
                    <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${val * 100}%`, background: color }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[var(--color-text-muted)] text-sm">Memuat...</p>
          )}
        </div>

        {/* Feature list */}
        <div className="glass-card p-6 lg:col-span-2 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 size={18} className="text-[var(--color-primary-light)]" />
            Fitur Model ({features.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {features.map((f, i) => (
              <div key={f} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--color-bg-elevated)] text-sm">
                <span className="text-xs text-[var(--color-text-muted)] font-mono w-5">{i + 1}.</span>
                <span className="text-white font-mono text-xs">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
