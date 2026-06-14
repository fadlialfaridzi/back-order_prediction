'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Package,
  AlertTriangle,
  Activity,
  TrendingUp,
  ArrowRight,
  FlaskConical,
  Clock,
  CheckCircle,
} from 'lucide-react';
import { getModelInfo, getHealth, type ModelInfo } from './lib/api';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ElementType;
  color: string;
  delay: number;
}

function StatsCard({ title, value, subtitle, icon: Icon, color, delay }: StatsCardProps) {
  return (
    <div
      className="glass-card p-5 animate-fade-in-up"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            {title}
          </p>
          <p className="text-2xl font-bold mt-2 text-white">{value}</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">{subtitle}</p>
        </div>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: `${color}15` }}
        >
          <Icon size={20} style={{ color }} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [health, setHealth] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    getModelInfo().then(setModelInfo).catch(() => {});
    getHealth().then(setHealth).catch(() => {});
  }, []);

  const metrics = modelInfo?.evaluation_metrics;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
          Dashboard
        </h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-sm lg:text-base">
          Ringkasan sistem prediksi backorder &amp; status model ML.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="Model"
          value={modelInfo?.model_class || '—'}
          subtitle="Random Forest Classifier"
          icon={FlaskConical}
          color="#6366f1"
          delay={0}
        />
        <StatsCard
          title="Fitur"
          value={modelInfo?.feature_names?.length ?? '—'}
          subtitle="Input parameters"
          icon={Package}
          color="#06b6d4"
          delay={0.05}
        />
        <StatsCard
          title="Akurasi"
          value={metrics ? `${(metrics.accuracy * 100).toFixed(1)}%` : '—'}
          subtitle={`F1: ${metrics ? metrics.f1_score.toFixed(4) : '—'}`}
          icon={TrendingUp}
          color="#10b981"
          delay={0.1}
        />
        <StatsCard
          title="Threshold"
          value={modelInfo ? `${(modelInfo.optimal_threshold * 100).toFixed(0)}%` : '—'}
          subtitle="Optimal threshold"
          icon={Activity}
          color="#f59e0b"
          delay={0.15}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System health */}
        <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Activity size={18} className="text-[var(--color-primary-light)]" />
            Status Sistem
          </h2>
          <div className="space-y-3">
            {[
              { key: 'backend', label: 'Backend API', desc: 'Express.js :5000' },
              { key: 'database', label: 'Database', desc: 'PostgreSQL' },
              { key: 'model_service', label: 'Model Service', desc: 'Flask :5001' },
            ].map(item => {
              const status = health?.[item.key];
              const isOk = status === 'ok';
              return (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-bg-elevated)]"
                >
                  <div className="flex items-center gap-3">
                    {isOk ? (
                      <CheckCircle size={16} className="text-emerald-400" />
                    ) : status === undefined ? (
                      <Clock size={16} className="text-[var(--color-text-muted)] animate-spin" />
                    ) : (
                      <AlertTriangle size={16} className="text-red-400" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{item.desc}</p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    isOk
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : status === undefined
                        ? 'bg-yellow-500/15 text-yellow-400'
                        : 'bg-red-500/15 text-red-400'
                  }`}>
                    {isOk ? 'Online' : status === undefined ? 'Checking...' : 'Offline'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick actions */}
        <div className="glass-card p-6 animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <FlaskConical size={18} className="text-[var(--color-primary-light)]" />
            Mulai Cepat
          </h2>
          <div className="space-y-3">
            <Link
              href="/predict"
              className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-indigo-500/10 to-cyan-500/10 border border-indigo-500/20 hover:border-indigo-500/40 transition-all group"
            >
              <div>
                <p className="text-sm font-semibold text-white">Prediksi Single Item</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Masukkan 21 parameter untuk memprediksi backorder
                </p>
              </div>
              <ArrowRight size={18} className="text-[var(--color-text-muted)] group-hover:text-white group-hover:translate-x-1 transition-all" />
            </Link>

            <Link
              href="/predict"
              className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 hover:border-emerald-500/40 transition-all group"
            >
              <div>
                <p className="text-sm font-semibold text-white">Batch Prediction</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Upload CSV untuk prediksi massal (segera hadir)
                </p>
              </div>
              <ArrowRight size={18} className="text-[var(--color-text-muted)] group-hover:text-white group-hover:translate-x-1 transition-all" />
            </Link>

            <Link
              href="/analysis"
              className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 hover:border-amber-500/40 transition-all group"
            >
              <div>
                <p className="text-sm font-semibold text-white">Analisis Model</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Lihat performa, fitur penting, dan metrik evaluasi
                </p>
              </div>
              <ArrowRight size={18} className="text-[var(--color-text-muted)] group-hover:text-white group-hover:translate-x-1 transition-all" />
            </Link>
          </div>
        </div>

        {/* Model metrics */}
        {metrics && (
          <div className="glass-card p-6 lg:col-span-2 animate-fade-in-up" style={{ animationDelay: '0.3s' }}>
            <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp size={18} className="text-[var(--color-primary-light)]" />
              Metrik Evaluasi Model
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {[
                { label: 'Accuracy', value: metrics.accuracy, color: '#6366f1' },
                { label: 'Precision', value: metrics.precision, color: '#06b6d4' },
                { label: 'Recall', value: metrics.recall, color: '#10b981' },
                { label: 'F1-Score', value: metrics.f1_score, color: '#f59e0b' },
                { label: 'ROC-AUC', value: metrics.roc_auc, color: '#ec4899' },
              ].map(m => (
                <div key={m.label} className="text-center p-4 rounded-xl bg-[var(--color-bg-elevated)]">
                  <p className="text-xs text-[var(--color-text-muted)] mb-2">{m.label}</p>
                  <p className="text-xl font-bold" style={{ color: m.color }}>
                    {(m.value * 100).toFixed(1)}%
                  </p>
                  <div className="mt-2 w-full h-1.5 rounded-full bg-[var(--color-border)]">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{
                        width: `${m.value * 100}%`,
                        background: m.color,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {modelInfo && (
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
                <span>Dilatih: {new Date(modelInfo.trained_at).toLocaleDateString('id-ID')}</span>
                <span>•</span>
                <span>SMOTE: {modelInfo.smote_applied ? 'Ya' : 'Tidak'}</span>
                <span>•</span>
                <span>Estimators: {String(modelInfo.parameters?.n_estimators ?? '—')}</span>
                <span>•</span>
                <span>Class Weight: {String(modelInfo.parameters?.class_weight ?? '—')}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
