/**
 * lib/api.ts
 * Semua type, konstanta, dan helper fetch yang dipakai frontend.
 * Satu tempat — ubah API_BASE di sini atau lewat env NEXT_PUBLIC_API_URL.
 */

export const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:5000';

// Daftar 21 kolom fitur model — dipakai batch page untuk menampilkan format CSV
export const FEATURE_COLUMNS_LIST = [
  'national_inv', 'lead_time', 'in_transit_qty',
  'forecast_3_month', 'forecast_6_month', 'forecast_9_month',
  'sales_1_month', 'sales_3_month', 'sales_6_month', 'sales_9_month',
  'min_bank', 'potential_issue', 'pieces_past_due',
  'perf_6_month_avg', 'perf_12_month_avg', 'local_bo_qty',
  'deck_risk', 'oe_constraint', 'ppap_risk', 'stop_auto_buy', 'rev_stop',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PredictionInput {
  // Inventaris
  national_inv: number;
  lead_time: number;
  in_transit_qty: number;
  min_bank: number;
  pieces_past_due: number;
  local_bo_qty: number;
  // Penjualan historis
  sales_1_month: number;
  sales_3_month: number;
  sales_6_month: number;
  sales_9_month: number;
  // Forecast permintaan
  forecast_3_month: number;
  forecast_6_month: number;
  forecast_9_month: number;
  // Performa supplier (sentinel -99 = belum ada data)
  perf_6_month_avg: number;
  perf_12_month_avg: number;
  // Risk flags (0 | 1)
  potential_issue: number;
  deck_risk: number;
  oe_constraint: number;
  ppap_risk: number;
  stop_auto_buy: number;
  rev_stop: number;
}

export interface PredictionResult {
  // Flask baru mengembalikan probability_backorder, bukan probability
  probability_backorder: number; // 0–1 (dari Flask)
  probability: number;           // 0–1 (di-alias dari probability_backorder di transform)
  prediction: number;            // 0 | 1
  status: string;                // "Aman" | "Backorder"
  is_backorder: boolean;         // di-derive di frontend
  threshold_used: number;        // 0–1
  model_version?: string;
  sku?: string;
}

export interface BatchResultItem {
  index: number;
  probability_backorder: number; // 0–1 (dari Flask baru)
  probability: number;           // alias agar komponen lama tetap bekerja
  prediction: number;
  status: string;
  is_backorder: boolean;
  sku?: string | null;
}

export interface BatchSummary {
  total: number;
  backorder: number;
  aman: number;
  // Flask baru: backorder_percentage. Flask lama: backorder_pct.
  // Kita normalkan ke backorder_pct di transform.
  backorder_pct: number;
}

export interface BatchPredictResponse {
  results: BatchResultItem[];
  summary: BatchSummary;
  threshold_used: number;
}

export interface LogPrediksiItem {
  sku: string;
  nama_barang: string;
  kategori_barang: string;
  probabilitas_backorder: number; // 0–100 (persen) sesuai skema DB NUMERIC(5,2)
  is_backorder: boolean;
  status: string;
  tanggal_prediksi: string;
}

/**
 * ModelInfo — memetakan respons /model/info dari Flask baru (schema_version 2)
 * sekaligus tetap kompatibel dengan respons lama.
 */
export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1_score: number;   // dinormalisasi dari "f1" (Flask baru) atau "f1_score" (lama)
  roc_auc: number | null;
  average_precision?: number;
}

export interface ModelInfo {
  // --- Identitas ---
  trained_at: string;
  model_type?: string;   // Flask baru: "sklearn.pipeline.Pipeline(RandomForestClassifier)"
  model_class?: string;  // Flask lama: "RandomForestClassifier"

  // --- Threshold ---
  optimal_threshold: number;
  threshold_status?: string;     // "tuned" | "not_tuned" | "unknown"
  threshold_tuned_at?: string;   // lama — mungkin tidak ada di schema baru

  // --- Parameter model ---
  parameters?: {
    n_estimators?: number;
    max_depth?: number | null;
    class_weight?: string | null;
    [key: string]: unknown;
  };
  model_parameters?: {           // Flask baru memakai model_parameters
    n_estimators?: number;
    max_depth?: number | null;
    class_weight?: string | null;
    [key: string]: unknown;
  };

  // --- Fitur ---
  feature_names: string[];
  numeric_features?: string[];
  binary_features?: string[];

  // --- Metrik evaluasi ---
  // Flask lama: evaluation_metrics.{accuracy, precision, recall, f1_score, roc_auc}
  // Flask baru: validation_metrics_before_threshold_tuning.{accuracy, precision, recall, f1, roc_auc}
  evaluation_metrics?: ModelMetrics;
  validation_metrics_before_threshold_tuning?: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1?: number;           // Flask baru pakai "f1" bukan "f1_score"
    roc_auc?: number;
    average_precision?: number;
  };

  // --- Lain-lain (Flask lama) ---
  smote_applied?: boolean;
  library_versions?: Record<string, string>;
}

export interface BarangItem {
  sku: string;
  nama_barang: string;
  kategori_barang: string;
  stok_saat_ini: number;
  national_inv: number;
  lead_time: number;
  in_transit_qty: number;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// FEATURE_GROUPS — dipakai predict/page.tsx untuk render form
// ---------------------------------------------------------------------------

type NumericField = {
  key: string;
  label: string;
  desc: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

type ToggleField = {
  key: string;
  label: string;
  desc: string;
  type: 'toggle';
  default: number;
};

type FeatureField = NumericField | ToggleField;

export interface FeatureGroup {
  title: string;
  icon: string;
  fields: FeatureField[];
}

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: 'Inventaris & Logistik',
    icon: 'Package',
    fields: [
      { key: 'national_inv',   label: 'National Inv',    desc: 'Jumlah stok saat ini di gudang nasional',           min: 0, max: 100000, step: 1,   default: 100 },
      { key: 'lead_time',      label: 'Lead Time (hari)', desc: 'Waktu rata-rata pengiriman dari supplier (hari)',   min: 0, max: 365,    step: 1,   default: 7 },
      { key: 'in_transit_qty', label: 'In Transit Qty',  desc: 'Jumlah unit sedang dalam perjalanan pengiriman',    min: 0, max: 50000,  step: 1,   default: 0 },
      { key: 'min_bank',       label: 'Min Bank',        desc: 'Stok minimum yang wajib dijaga di gudang',          min: 0, max: 10000,  step: 1,   default: 10 },
      { key: 'pieces_past_due',label: 'Pieces Past Due', desc: 'Unit yang melewati batas waktu penerimaan',         min: 0, max: 10000,  step: 1,   default: 0 },
      { key: 'local_bo_qty',   label: 'Local BO Qty',    desc: 'Jumlah item yang sudah dalam status backorder lokal', min: 0, max: 1000, step: 1,   default: 0 },
    ],
  },
  {
    title: 'Penjualan Historis',
    icon: 'ShoppingCart',
    fields: [
      { key: 'sales_1_month', label: 'Sales 1 Bulan',  desc: 'Total penjualan 1 bulan terakhir',  min: 0, max: 100000, step: 1, default: 50 },
      { key: 'sales_3_month', label: 'Sales 3 Bulan',  desc: 'Total penjualan 3 bulan terakhir',  min: 0, max: 300000, step: 1, default: 150 },
      { key: 'sales_6_month', label: 'Sales 6 Bulan',  desc: 'Total penjualan 6 bulan terakhir',  min: 0, max: 600000, step: 1, default: 300 },
      { key: 'sales_9_month', label: 'Sales 9 Bulan',  desc: 'Total penjualan 9 bulan terakhir',  min: 0, max: 900000, step: 1, default: 450 },
    ],
  },
  {
    title: 'Forecast Permintaan',
    icon: 'TrendingUp',
    fields: [
      { key: 'forecast_3_month', label: 'Forecast 3 Bulan', desc: 'Proyeksi permintaan 3 bulan ke depan', min: 0, max: 500000, step: 1, default: 200 },
      { key: 'forecast_6_month', label: 'Forecast 6 Bulan', desc: 'Proyeksi permintaan 6 bulan ke depan', min: 0, max: 500000, step: 1, default: 400 },
      { key: 'forecast_9_month', label: 'Forecast 9 Bulan', desc: 'Proyeksi permintaan 9 bulan ke depan', min: 0, max: 500000, step: 1, default: 600 },
    ],
  },
  {
    title: 'Performa Supplier',
    icon: 'BarChart3',
    fields: [
      { key: 'perf_6_month_avg',  label: 'Performa 6 Bln',  desc: 'Rata-rata skor performa supplier 6 bulan (0–1, -99 = belum ada)',  min: -99, max: 1, step: 0.01, default: -99 },
      { key: 'perf_12_month_avg', label: 'Performa 12 Bln', desc: 'Rata-rata skor performa supplier 12 bulan (0–1, -99 = belum ada)', min: -99, max: 1, step: 0.01, default: -99 },
    ],
  },
  {
    title: 'Risk Flags',
    icon: 'AlertTriangle',
    fields: [
      { key: 'potential_issue', label: 'Potential Issue', desc: 'Potensi masalah pengiriman teridentifikasi', type: 'toggle', default: 0 },
      { key: 'deck_risk',       label: 'Deck Risk',       desc: 'Risiko perubahan desain produk',             type: 'toggle', default: 0 },
      { key: 'oe_constraint',   label: 'OE Constraint',   desc: 'Keterbatasan dari OEM/Original Equipment',   type: 'toggle', default: 0 },
      { key: 'ppap_risk',       label: 'PPAP Risk',       desc: 'Risiko proses persetujuan produksi (PPAP)',   type: 'toggle', default: 0 },
      { key: 'stop_auto_buy',   label: 'Stop Auto Buy',   desc: 'Pembelian otomatis dihentikan sementara',    type: 'toggle', default: 0 },
      { key: 'rev_stop',        label: 'Rev Stop',        desc: 'Revisi produk menyebabkan penghentian order', type: 'toggle', default: 0 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Normalisasi respons API
// ---------------------------------------------------------------------------

/**
 * Normalisasi respons /model/info agar mendukung schema lama DAN baru.
 *
 * Flask lama:  { model_class, evaluation_metrics.{f1_score}, parameters }
 * Flask baru:  { model_type, validation_metrics_before_threshold_tuning.{f1}, model_parameters }
 */
function normalizeModelInfo(raw: ModelInfo): ModelInfo {
  const info = { ...raw };

  // Normalisasi nama model
  if (!info.model_class && info.model_type) {
    // Ambil nama kelas dari string panjang seperti
    // "sklearn.pipeline.Pipeline(RandomForestClassifier)"
    const match = info.model_type.match(/\(([^)]+)\)$/);
    info.model_class = match ? match[1] : info.model_type;
  }

  // Normalisasi parameter
  if (!info.parameters && info.model_parameters) {
    info.parameters = info.model_parameters as ModelInfo['parameters'];
  }

  // Normalisasi metrik evaluasi
  if (!info.evaluation_metrics) {
    const vm = info.validation_metrics_before_threshold_tuning;
    if (vm) {
      info.evaluation_metrics = {
        accuracy:  vm.accuracy  ?? 0,
        precision: vm.precision ?? 0,
        recall:    vm.recall    ?? 0,
        // Flask baru: "f1", Flask lama: "f1_score"
        f1_score:  vm.f1        ?? 0,
        roc_auc:   vm.roc_auc  ?? null,
        average_precision: vm.average_precision,
      };
    }
  } else {
    // Pastikan f1_score ada (Flask lama sudah punya ini)
    if (info.evaluation_metrics && !('f1_score' in info.evaluation_metrics)) {
      (info.evaluation_metrics as Record<string, unknown>).f1_score =
        (info.evaluation_metrics as Record<string, unknown>).f1 ?? 0;
    }
  }

  return info;
}

/**
 * Normalisasi respons /predict (single) agar probability selalu ada.
 * Flask baru: probability_backorder. Flask lama: probability.
 */
function normalizePredictResult(raw: PredictionResult): PredictionResult {
  const prob = raw.probability_backorder ?? raw.probability ?? 0;
  return {
    ...raw,
    probability_backorder: prob,
    probability: prob,
    is_backorder: raw.prediction === 1,
  };
}

/**
 * Normalisasi respons /predict/batch.
 * Flask baru: item.probability_backorder, summary.backorder_percentage
 * Flask lama: item.probability, summary.backorder_pct
 */
function normalizeBatchResponse(raw: BatchPredictResponse): BatchPredictResponse {
  const results = raw.results.map(r => {
    const prob = r.probability_backorder ?? r.probability ?? 0;
    return {
      ...r,
      probability_backorder: prob,
      probability: prob,
      is_backorder: r.prediction === 1,
    };
  });

  const rawSummary = raw.summary as BatchSummary & { backorder_percentage?: number };
  const backorder_pct =
    rawSummary.backorder_pct ??
    rawSummary.backorder_percentage ??
    (rawSummary.total > 0 ? (rawSummary.backorder / rawSummary.total) * 100 : 0);

  return {
    ...raw,
    results,
    summary: { ...raw.summary, backorder_pct },
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string; message?: string }).error
      ?? (body as { error?: string; message?: string }).message
      ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const predictSingle = (data: PredictionInput): Promise<PredictionResult> =>
  apiFetch<PredictionResult>('/api/predict', {
    method: 'POST',
    body: JSON.stringify(data),
  }).then(normalizePredictResult);

export const predictBatch = (data: Record<string, unknown>[]): Promise<BatchPredictResponse> =>
  apiFetch<BatchPredictResponse>('/api/predict/batch', {
    method: 'POST',
    body: JSON.stringify({ data }),
  }).then(normalizeBatchResponse);

export const runAllPredictions = (): Promise<{ summary: BatchSummary; written: number; threshold_used: number }> =>
  apiFetch('/api/predict/run-all', { method: 'POST' });

export const getBarang = (): Promise<BarangItem[]> =>
  apiFetch<BarangItem[]>('/api/barang');

export const getPredictLog = (): Promise<LogPrediksiItem[]> =>
  apiFetch<LogPrediksiItem[]>('/api/predict/log');

export const getModelInfo = (): Promise<ModelInfo> =>
  apiFetch<ModelInfo>('/api/model/info').then(normalizeModelInfo);

export const getHealth = (): Promise<Record<string, string>> =>
  apiFetch<Record<string, string>>('/api/health');