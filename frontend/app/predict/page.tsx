'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Package,
  TrendingUp,
  ShoppingCart,
  BarChart3,
  AlertTriangle,
  Loader2,
  RotateCcw,
  Send,
  Info,
} from 'lucide-react';
import RiskGauge from '../components/RiskGauge';
import { predictSingle, FEATURE_GROUPS, type PredictionInput, type PredictionResult } from '../lib/api';

// Map icon string to component
const ICON_MAP: Record<string, React.ElementType> = {
  Package, TrendingUp, ShoppingCart, BarChart3, AlertTriangle,
};

// Build default values from feature groups
function getDefaults(): PredictionInput {
  const defaults: Record<string, number> = {};
  for (const group of FEATURE_GROUPS) {
    for (const field of group.fields) {
      defaults[field.key] = field.default;
    }
  }
  return defaults as unknown as PredictionInput;
}

export default function PredictPage() {
  const [formData, setFormData] = useState<PredictionInput>(getDefaults);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback((key: string, value: number) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleToggle = useCallback((key: string) => {
    setFormData(prev => ({
      ...prev,
      [key]: prev[key as keyof PredictionInput] === 1 ? 0 : 1,
    }));
  }, []);

  const handleReset = useCallback(() => {
    setFormData(getDefaults());
    setResult(null);
    setError(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await predictSingle(formData);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan');
    } finally {
      setLoading(false);
    }
  }, [formData]);

  // Count active risk flags
  const activeRisks = useMemo(() => {
    const riskKeys = ['potential_issue', 'deck_risk', 'oe_constraint', 'ppap_risk', 'stop_auto_buy', 'rev_stop'];
    return riskKeys.filter(k => formData[k as keyof PredictionInput] === 1).length;
  }, [formData]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
          Prediksi Backorder
        </h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-sm lg:text-base">
          Masukkan parameter inventaris dan supply chain untuk memprediksi risiko backorder produk.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Form — 2 columns */}
        <div className="xl:col-span-2 space-y-6">
          {FEATURE_GROUPS.map((group, gi) => {
            const IconComp = ICON_MAP[group.icon] || Package;
            return (
              <div
                key={group.title}
                className="glass-card p-6 animate-fade-in-up"
                style={{ animationDelay: `${gi * 0.08}s` }}
              >
                {/* Section header */}
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center">
                    <IconComp size={18} className="text-[var(--color-primary-light)]" />
                  </div>
                  <h2 className="text-base font-semibold text-white">{group.title}</h2>
                  {group.title === 'Risk Flags' && activeRisks > 0 && (
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 font-medium">
                      {activeRisks} aktif
                    </span>
                  )}
                </div>

                {/* Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
                  {group.fields.map((field) => {
                    const val = formData[field.key as keyof PredictionInput];
                    const isToggle = 'type' in field && field.type === 'toggle';

                    if (isToggle) {
                      return (
                        <div key={field.key} className="flex items-center justify-between sm:col-span-1">
                          <div className="flex-1 min-w-0">
                            <label className="text-sm font-medium text-[var(--color-text-primary)] block">
                              {field.label}
                            </label>
                            <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
                              {field.desc}
                            </p>
                          </div>
                          <label className="toggle-switch ml-3 shrink-0">
                            <input
                              type="checkbox"
                              checked={val === 1}
                              onChange={() => handleToggle(field.key)}
                            />
                            <span className="toggle-slider" />
                          </label>
                        </div>
                      );
                    }

                    // Numeric field — slider + input
                    const numField = field as { key: string; label: string; min: number; max: number; step: number; default: number; desc: string };
                    return (
                      <div key={field.key}>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-sm font-medium text-[var(--color-text-primary)]">
                            {field.label}
                          </label>
                          <div className="group relative">
                            <Info size={13} className="text-[var(--color-text-muted)] cursor-help" />
                            <div className="absolute right-0 bottom-full mb-2 w-48 p-2 rounded-lg bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 shadow-lg">
                              {field.desc}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={numField.min}
                            max={numField.max}
                            step={numField.step}
                            value={val}
                            onChange={e => handleChange(field.key, parseFloat(e.target.value))}
                            className="flex-1"
                          />
                          <input
                            type="number"
                            min={numField.min}
                            max={numField.max}
                            step={numField.step}
                            value={val}
                            onChange={e => handleChange(field.key, parseFloat(e.target.value) || 0)}
                            className="input-field w-24 text-right text-sm"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Result panel — sticky */}
        <div className="xl:col-span-1">
          <div className="sticky top-6 space-y-4">
            {/* Actions */}
            <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
              <div className="flex gap-3">
                <button
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                  onClick={handleSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Memproses...
                    </>
                  ) : (
                    <>
                      <Send size={18} />
                      Prediksi
                    </>
                  )}
                </button>
                <button
                  className="px-4 py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-all"
                  onClick={handleReset}
                  title="Reset semua nilai"
                >
                  <RotateCcw size={18} />
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="glass-card p-4 border-red-500/30 animate-fade-in-up">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-400">Prediksi Gagal</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1">{error}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Result gauge */}
            {result && (
              <div className={`glass-card p-6 animate-fade-in-up ${
                result.prediction === 1 ? 'glow-danger' : 'glow-success'
              }`}>
                <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4 text-center">
                  Hasil Prediksi
                </h3>
                <RiskGauge
                  probability={result.probability}
                  threshold={result.threshold_used}
                  status={result.status}
                />

                {/* Detail metrics */}
                <div className="mt-6 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-text-muted)]">Probabilitas</span>
                    <span className="font-mono font-medium">{(result.probability * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-text-muted)]">Threshold</span>
                    <span className="font-mono font-medium">{(result.threshold_used * 100).toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-text-muted)]">Keputusan</span>
                    <span className={`font-semibold ${
                      result.prediction === 1 ? 'text-red-400' : 'text-emerald-400'
                    }`}>
                      {result.status}
                    </span>
                  </div>
                </div>

                {/* Interpretation */}
                <div className="mt-5 p-3 rounded-lg bg-[var(--color-bg-elevated)] text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  {result.prediction === 1 ? (
                    <>
                      <strong className="text-red-400">⚠ Risiko Tinggi:</strong> Model memprediksi produk ini
                      berpotensi mengalami backorder. Pertimbangkan untuk menambah stok, mempercepat
                      procurement, atau mencari supplier alternatif.
                    </>
                  ) : (
                    <>
                      <strong className="text-emerald-400">✓ Aman:</strong> Model memprediksi produk ini
                      tidak berisiko mengalami backorder. Stok dan supply chain dalam kondisi normal.
                    </>
                  )}
                </div>
              </div>
            )}

            {/* No result placeholder */}
            {!result && !error && (
              <div className="glass-card p-8 animate-fade-in-up flex flex-col items-center text-center" style={{ animationDelay: '0.4s' }}>
                <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-elevated)] flex items-center justify-center mb-4">
                  <BarChart3 size={28} className="text-[var(--color-text-muted)]" />
                </div>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Isi parameter di sebelah kiri, lalu klik <strong className="text-white">Prediksi</strong> untuk
                  melihat hasilnya di sini.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
