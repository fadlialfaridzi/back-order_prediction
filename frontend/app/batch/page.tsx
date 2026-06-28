'use client';

import { useState, useCallback } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Download,
  Trash2,
  Info,
} from 'lucide-react';
import { API_BASE, FEATURE_COLUMNS_LIST } from '../lib/api';

// Daftar 21 kolom fitur yang wajib ada di CSV
const REQUIRED_COLUMNS = [
  'national_inv', 'lead_time', 'in_transit_qty',
  'forecast_3_month', 'forecast_6_month', 'forecast_9_month',
  'sales_1_month', 'sales_3_month', 'sales_6_month', 'sales_9_month',
  'min_bank', 'potential_issue', 'pieces_past_due',
  'perf_6_month_avg', 'perf_12_month_avg', 'local_bo_qty',
  'deck_risk', 'oe_constraint', 'ppap_risk', 'stop_auto_buy', 'rev_stop',
];

interface BatchResult {
  index: number;
  sku: string | null;
  probability: number;
  prediction: number;
  status: string;
  is_backorder: boolean;
}

interface UploadResponse {
  results: BatchResult[];
  summary: {
    total: number;
    backorder: number;
    aman: number;
    backorder_pct: number;
  };
  threshold_used: number;
  rows_parsed: number;
  filename: string;
}

export default function BatchPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (f: File) => {
    if (!f.name.endsWith('.csv')) {
      setError('Hanya file CSV yang diizinkan.');
      return;
    }
    setFile(f);
    setError(null);
    setResult(null);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE}/api/predict/upload-csv`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memproses file.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  const handleExportCSV = () => {
    if (!result) return;
    const headers = ['No', 'SKU', 'Probabilitas (%)', 'Status'];
    const rows = result.results.map((r, i) => [
      i + 1,
      r.sku || '-',
      (r.probability * 100).toFixed(2),
      r.status,
    ]);
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prediksi_batch_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-white">
          Batch Prediction
        </h1>
        <p className="text-[var(--color-text-secondary)] mt-2 text-sm">
          Upload file CSV berisi data inventaris untuk prediksi backorder massal.
        </p>
      </div>

      {/* Summary cards — tampil jika ada hasil */}
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 animate-fade-in-up">
          {[
            { label: 'Total Item', value: result.summary.total, color: '#6366f1' },
            { label: 'Backorder', value: result.summary.backorder, color: '#ef4444' },
            { label: 'Aman', value: result.summary.aman, color: '#10b981' },
            { label: 'Backorder %', value: `${result.summary.backorder_pct}%`, color: '#f59e0b' },
          ].map(card => (
            <div key={card.label} className="glass-card p-4 text-center">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">{card.label}</p>
              <p className="text-2xl font-bold mt-1" style={{ color: card.color }}>
                {card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Upload zone */}
      {!result && (
        <div className="space-y-6 animate-fade-in-up">
          {/* Drop zone */}
          <div
            className={`glass-card p-8 text-center border-2 border-dashed transition-all cursor-pointer ${
              dragOver
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                : 'border-[var(--color-border)] hover:border-[var(--color-border-light)]'
            }`}
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => document.getElementById('csv-input')?.click()}
          >
            <input
              id="csv-input"
              type="file"
              accept=".csv"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Upload size={40} className="mx-auto mb-4 text-[var(--color-text-muted)]" />
            <p className="text-sm text-white font-medium">
              {file ? file.name : 'Drag & drop file CSV atau klik untuk memilih'}
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-2">
              Maksimal 10.000 baris · Maks 10 MB
            </p>

            {file && (
              <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-bg-elevated)]">
                <FileSpreadsheet size={16} className="text-[var(--color-primary-light)]" />
                <span className="text-sm text-white">{file.name}</span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  ({(file.size / 1024).toFixed(1)} KB)
                </span>
              </div>
            )}
          </div>

          {/* Format info */}
          <div className="glass-card p-5">
            <div className="flex items-start gap-3">
              <Info size={18} className="text-[var(--color-primary-light)] mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-white mb-2">Format CSV yang Dibutuhkan</p>
                <p className="text-xs text-[var(--color-text-secondary)] mb-3">
                  File CSV harus mengandung minimal 21 kolom fitur berikut (kolom <code className="px-1 py-0.5 rounded bg-[var(--color-bg-elevated)] text-[var(--color-primary-light)]">sku</code> opsional sebagai identifier):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {REQUIRED_COLUMNS.map(col => (
                    <span
                      key={col}
                      className="text-[10px] font-mono px-2 py-1 rounded-md bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="glass-card p-4 border border-red-500/20 bg-red-500/5">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleUpload}
              disabled={!file || loading}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-light)] transition-all text-sm font-medium disabled:opacity-60"
            >
              {loading ? (
                <><Loader2 size={16} className="animate-spin" /> Memproses...</>
              ) : (
                <><Upload size={16} /> Upload & Prediksi</>
              )}
            </button>
            {file && (
              <button
                onClick={handleReset}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-3 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-all text-sm"
              >
                <Trash2 size={15} /> Reset
              </button>
            )}
          </div>
        </div>
      )}

      {/* Results table */}
      {result && (
        <div className="space-y-4 animate-fade-in-up">
          {/* Actions bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--color-text-secondary)]">
              File: <span className="text-white font-medium">{result.filename}</span> · Threshold: {(result.threshold_used * 100).toFixed(0)}%
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-all text-sm"
              >
                <Download size={15} /> Export CSV
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-white transition-all text-sm"
              >
                <Trash2 size={15} /> Upload Baru
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase">SKU</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase">Probabilitas</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {result.results.map((r, i) => (
                    <tr key={i} className="hover:bg-[var(--color-bg-hover)] transition-colors">
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] font-mono">{i + 1}</td>
                      <td className="px-4 py-3 text-xs font-mono text-[var(--color-primary-light)]">
                        {r.sku || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-[var(--color-border)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(r.probability * 100, 100)}%`,
                                background:
                                  r.probability >= 0.5 ? '#ef4444' :
                                  r.probability >= 0.15 ? '#f59e0b' : '#10b981',
                              }}
                            />
                          </div>
                          <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                            {(r.probability * 100).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                          r.is_backorder
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-emerald-500/15 text-emerald-400'
                        }`}>
                          {r.is_backorder ? '⚠ Backorder' : '✓ Aman'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
