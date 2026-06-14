const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export interface PredictionInput {
  national_inv: number;
  lead_time: number;
  in_transit_qty: number;
  forecast_3_month: number;
  forecast_6_month: number;
  forecast_9_month: number;
  sales_1_month: number;
  sales_3_month: number;
  sales_6_month: number;
  sales_9_month: number;
  min_bank: number;
  potential_issue: number;
  pieces_past_due: number;
  perf_6_month_avg: number;
  perf_12_month_avg: number;
  local_bo_qty: number;
  deck_risk: number;
  oe_constraint: number;
  ppap_risk: number;
  stop_auto_buy: number;
  rev_stop: number;
}

export interface PredictionResult {
  probability: number;
  prediction: number;
  status: string;
  threshold_used: number;
}

export interface BatchResult {
  results: Array<{
    index: number;
    probability: number;
    prediction: number;
    status: string;
  }>;
  summary: {
    total: number;
    backorder: number;
    aman: number;
    backorder_pct: number;
  };
  threshold_used: number;
}

export interface ModelInfo {
  trained_at: string;
  model_class: string;
  parameters: Record<string, unknown>;
  smote_applied: boolean;
  feature_names: string[];
  evaluation_metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1_score: number;
    roc_auc: number;
  };
  optimal_threshold: number;
  threshold_tuned_at: string;
}

export async function predictSingle(input: PredictionInput): Promise<PredictionResult> {
  const res = await fetch(`${API_BASE}/api/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function predictBatch(data: PredictionInput[]): Promise<BatchResult> {
  const res = await fetch(`${API_BASE}/api/predict/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getModelInfo(): Promise<ModelInfo> {
  const res = await fetch(`${API_BASE}/api/model/info`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getHealth(): Promise<Record<string, string>> {
  const res = await fetch(`${API_BASE}/api/health`);
  return res.json();
}

/**
 * Feature definitions — metadata untuk membangun form dinamis
 */
export const FEATURE_GROUPS = [
  {
    title: 'Inventaris',
    icon: 'Package',
    fields: [
      { key: 'national_inv', label: 'Stok Nasional', min: -1000, max: 500000, step: 1, default: 100, desc: 'Jumlah stok di seluruh gudang nasional' },
      { key: 'in_transit_qty', label: 'Dalam Pengiriman', min: 0, max: 50000, step: 1, default: 0, desc: 'Jumlah barang yang sedang dalam perjalanan' },
      { key: 'lead_time', label: 'Lead Time (hari)', min: 0, max: 52, step: 1, default: 8, desc: 'Waktu tunggu pengiriman dari supplier' },
      { key: 'min_bank', label: 'Stok Minimum', min: 0, max: 50000, step: 1, default: 0, desc: 'Batas minimum stok yang harus dijaga' },
      { key: 'local_bo_qty', label: 'Lokal Backorder Qty', min: 0, max: 10000, step: 1, default: 0, desc: 'Jumlah backorder lokal saat ini' },
      { key: 'pieces_past_due', label: 'Unit Terlambat', min: 0, max: 50000, step: 1, default: 0, desc: 'Jumlah unit yang terlambat dikirim' },
    ],
  },
  {
    title: 'Forecast',
    icon: 'TrendingUp',
    fields: [
      { key: 'forecast_3_month', label: 'Forecast 3 Bulan', min: 0, max: 500000, step: 1, default: 0, desc: 'Proyeksi permintaan 3 bulan ke depan' },
      { key: 'forecast_6_month', label: 'Forecast 6 Bulan', min: 0, max: 500000, step: 1, default: 0, desc: 'Proyeksi permintaan 6 bulan ke depan' },
      { key: 'forecast_9_month', label: 'Forecast 9 Bulan', min: 0, max: 500000, step: 1, default: 0, desc: 'Proyeksi permintaan 9 bulan ke depan' },
    ],
  },
  {
    title: 'Penjualan',
    icon: 'ShoppingCart',
    fields: [
      { key: 'sales_1_month', label: 'Penjualan 1 Bulan', min: 0, max: 500000, step: 1, default: 0, desc: 'Total penjualan 1 bulan terakhir' },
      { key: 'sales_3_month', label: 'Penjualan 3 Bulan', min: 0, max: 500000, step: 1, default: 0, desc: 'Total penjualan 3 bulan terakhir' },
      { key: 'sales_6_month', label: 'Penjualan 6 Bulan', min: 0, max: 500000, step: 1, default: 0, desc: 'Total penjualan 6 bulan terakhir' },
      { key: 'sales_9_month', label: 'Penjualan 9 Bulan', min: 0, max: 500000, step: 1, default: 0, desc: 'Total penjualan 9 bulan terakhir' },
    ],
  },
  {
    title: 'Performa',
    icon: 'BarChart3',
    fields: [
      { key: 'perf_6_month_avg', label: 'Performa 6 Bulan (%)', min: 0, max: 1, step: 0.01, default: 0.7, desc: 'Rata-rata performa supplier 6 bulan (0-1)' },
      { key: 'perf_12_month_avg', label: 'Performa 12 Bulan (%)', min: 0, max: 1, step: 0.01, default: 0.7, desc: 'Rata-rata performa supplier 12 bulan (0-1)' },
    ],
  },
  {
    title: 'Risk Flags',
    icon: 'AlertTriangle',
    fields: [
      { key: 'potential_issue', label: 'Potensi Masalah', type: 'toggle', default: 0, desc: 'Apakah ada potensi masalah yang teridentifikasi?' },
      { key: 'deck_risk', label: 'Deck Risk', type: 'toggle', default: 0, desc: 'Risiko terkait posisi barang di daftar prioritas' },
      { key: 'oe_constraint', label: 'OE Constraint', type: 'toggle', default: 0, desc: 'Kendala original equipment' },
      { key: 'ppap_risk', label: 'PPAP Risk', type: 'toggle', default: 0, desc: 'Risiko Production Part Approval Process' },
      { key: 'stop_auto_buy', label: 'Stop Auto Buy', type: 'toggle', default: 0, desc: 'Pembelian otomatis dihentikan?' },
      { key: 'rev_stop', label: 'Rev Stop', type: 'toggle', default: 0, desc: 'Review stop — produk dalam peninjauan?' },
    ],
  },
] as const;

export type FeatureKey = typeof FEATURE_GROUPS[number]['fields'][number]['key'];
