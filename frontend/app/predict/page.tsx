'use client';

import { useState } from 'react';
import {
  FlaskConical,
  Send,
  Loader2,
  AlertTriangle,
  CheckCircle,
  RotateCcw,
  Info,
} from 'lucide-react';
import {
  predictSingle,
  FEATURE_GROUPS,
  type PredictionInput,
  type PredictionResult,
} from '../lib/api';
import RiskGauge from '../components/RiskGauge';

// Default values dari FEATURE_GROUPS
function buildDefaults(): PredictionInput {
  const defaults: Record<string, number> = {};
  for (const group of FEATURE_GROUPS) {
    for (const f of group.fields) {
      defaults[f.key] = f.default;
    }
  }
  return defaults as unknown as PredictionInput;
}

export default function PredictPage() {
  const [form, setForm]       = useState<PredictionInput>(buildDefaults());
  const [result, setResult]   = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const updateField = (key: string, value: number) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await predictSingle(form);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menjalankan prediksi.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setForm(buildDefaults());
    setResult(null);
    setError(null);
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
          Prediksi Backorder
        </h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">
          Masukkan 21 parameter fitur untuk memprediksi risiko backorder suatu item.
        </p>
      </div>

      {/* Result card — tampil di atas jika ada hasil */}
      {result && (
        <div
          className={`glass-card p-6 mb-6 animate-fade-in-up border ${
            result.is_backorder
              ? 'border-red-500/30 bg-red-500/5'
              : 'border-emerald-500/30 bg-emerald-500/5'
          }`}
        >
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* RiskGauge visual */}
            <div className="flex-shrink-0 mx-auto sm:mx-0">
              <RiskGauge
                probability={result.probability}
                threshold={result.threshold_used}
                status={result.status}
                size={200}
              />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-white">
                {result.is_backorder ? '⚠ Risiko Backorder Terdeteksi' : '✓ Item Diprediksi Aman'}
              </h3>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                {result.is_backorder
                  ? 'Model mendeteksi potensi backorder. Pertimbangkan untuk menambah stok atau mempercepat pengadaan.'
                  : 'Model tidak mendeteksi risiko backorder saat ini. Tetap lakukan monitoring rutin.'}
              </p>
              <div className="flex flex-wrap gap-4 mt-4">
                <div className="px-4 py-2 rounded-lg bg-[var(--color-bg-elevated)]">
                  <p className="text-xs text-[var(--color-text-muted)]">Probabilitas</p>
                  <p className={`text-xl font-bold font-mono ${
                    result.is_backorder ? 'text-red-400' : 'text-emerald-400'
                  }`}>
                    {(result.probability * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="px-4 py-2 rounded-lg bg-[var(--color-bg-elevated)]">
                  <p className="text-xs text-[var(--color-text-muted)]">Status</p>
                  <p className={`text-xl font-bold ${
                    result.is_backorder ? 'text-red-400' : 'text-emerald-400'
                  }`}>
                    {result.status}
                  </p>
                </div>
                <div className="px-4 py-2 rounded-lg bg-[var(--color-bg-elevated)]">
                  <p className="text-xs text-[var(--color-text-muted)]">Threshold</p>
                  <p className="text-xl font-bold text-[var(--color-primary-light)] font-mono">
                    {(result.threshold_used * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
              {/* Probability bar */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-1">
                  <span>0%</span>
                  <span>Threshold {(result.threshold_used * 100).toFixed(0)}%</span>
                  <span>100%</span>
                </div>
                <div className="relative w-full h-3 rounded-full bg-[var(--color-border)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(result.probability * 100, 100)}%`,
                      background: result.is_backorder
                        ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                        : 'linear-gradient(90deg, #10b981, #06b6d4)',
                    }}
                  />
                  {/* Threshold marker */}
                  <div
                    className="absolute top-0 h-full w-0.5 bg-white/50"
                    style={{ left: `${result.threshold_used * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="glass-card p-4 mb-6 border border-red-500/20 bg-red-500/5 animate-fade-in-up">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Form groups */}
      <div className="space-y-6">
        {FEATURE_GROUPS.map((group, gi) => (
          <div
            key={group.title}
            className="glass-card p-6 animate-fade-in-up"
            style={{ animationDelay: `${gi * 0.05}s` }}
          >
            <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <FlaskConical size={18} className="text-[var(--color-primary-light)]" />
              {group.title}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {group.fields.map(field => {
                const value = form[field.key as keyof PredictionInput];

                // Toggle field (0/1)
                if ('type' in field && field.type === 'toggle') {
                  return (
                    <div key={field.key} className="p-3 rounded-xl bg-[var(--color-bg-elevated)]">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0 mr-3">
                          <label className="text-sm font-medium text-white block">{field.label}</label>
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{field.desc}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => updateField(field.key, value === 1 ? 0 : 1)}
                          className={`relative w-11 h-6 rounded-full transition-colors duration-200 flex-shrink-0 ${
                            value === 1
                              ? 'bg-[var(--color-primary)]'
                              : 'bg-[var(--color-border)]'
                          }`}
                        >
                          <div
                            className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                              value === 1 ? 'translate-x-[22px]' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  );
                }

                // Numeric field
                const numField = field as { key: string; label: string; desc: string; min: number; max: number; step: number; default: number };
                return (
                  <div key={field.key} className="p-3 rounded-xl bg-[var(--color-bg-elevated)]">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-sm font-medium text-white">{numField.label}</label>
                      <div className="group relative">
                        <Info size={13} className="text-[var(--color-text-muted)] cursor-help" />
                        <div className="absolute right-0 bottom-full mb-2 w-48 p-2 rounded-lg bg-[#1a1a2e] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 shadow-lg">
                          {numField.desc}
                        </div>
                      </div>
                    </div>
                    <input
                      type="number"
                      className="input-field text-sm font-mono"
                      value={value}
                      min={numField.min}
                      max={numField.max}
                      step={numField.step}
                      onChange={e => updateField(field.key, Number(e.target.value))}
                    />
                    {/* Range info */}
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1 font-mono">
                      Range: {numField.min} — {numField.max.toLocaleString()}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mt-6 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-all text-sm font-medium disabled:opacity-60"
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> Memproses...</>
            : <><Send size={16} /> Jalankan Prediksi</>}
        </button>
        <button
          onClick={handleReset}
          disabled={loading}
          className="flex items-center gap-2 px-5 py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-all text-sm"
        >
          <RotateCcw size={15} />
          Reset
        </button>
      </div>
    </div>
  );
}
