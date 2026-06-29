const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
require('dotenv').config();

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '10mb' }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        // Hanya terima CSV
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file CSV yang diizinkan.'));
        }
    },
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// ML inference service (Flask :5001)
const ML_SERVICE_URL = process.env.ML_SERVICE_URL
    || process.env.FLASK_URL       // backward-compat jika .env masih pakai FLASK_URL
    || 'http://localhost:5001';

const pool = new Pool({
    user:     process.env.DB_USER,
    host:     process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port:     process.env.DB_PORT,
    max: 20,
});

// 21 fitur model — harus sesuai feature_names di rf_model_metadata.json
const FEATURE_COLUMNS = [
    'national_inv', 'lead_time', 'in_transit_qty',
    'forecast_3_month', 'forecast_6_month', 'forecast_9_month',
    'sales_1_month', 'sales_3_month', 'sales_6_month', 'sales_9_month',
    'min_bank', 'potential_issue', 'pieces_past_due',
    'perf_6_month_avg', 'perf_12_month_avg', 'local_bo_qty',
    'deck_risk', 'oe_constraint', 'ppap_risk', 'stop_auto_buy', 'rev_stop',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Error handler untuk axios → ML service */
function handleMlError(err, res, route) {
    if (err.response) {
        return res.status(err.response.status).json(err.response.data);
    }
    console.error(`${route} error:`, err.message);
    return res.status(502).json({
        error: 'Model service tidak tersedia.',
        detail: err.message,
    });
}

/**
 * Validasi bahwa body mengandung semua 21 fitur dan nilainya numerik.
 * @returns {string|null} Pesan error, atau null jika valid.
 */
function validateFeatures(body) {
    if (!body || typeof body !== 'object') {
        return 'Request body harus berupa JSON object.';
    }
    const missing = FEATURE_COLUMNS.filter(f => !(f in body));
    if (missing.length > 0) {
        return `Fitur tidak lengkap: ${missing.join(', ')}`;
    }
    const nonNumeric = FEATURE_COLUMNS.filter(f => typeof body[f] !== 'number' || Number.isNaN(body[f]));
    if (nonNumeric.length > 0) {
        return `Fitur harus berupa angka: ${nonNumeric.join(', ')}`;
    }
    return null;
}

/**
 * Parse CSV string menjadi array of objects.
 * Menangani koma di dalam quotes dan newline variations.
 */
function parseCSV(csvString) {
    const lines = csvString.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        if (values.length !== headers.length) continue; // skip malformed rows

        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            const num = Number(values[j]);
            obj[headers[j]] = Number.isNaN(num) ? values[j] : num;
        }
        rows.push(obj);
    }
    return rows;
}

// ---------------------------------------------------------------------------
// Routes: Inventaris
// ---------------------------------------------------------------------------

/**
 * GET /api/barang
 * Mengembalikan data master_barang + seluruh 21 fitur dari mutasi_inventaris.
 * Dipakai oleh halaman Inventaris dan juga sebagai sumber data run-all.
 */
app.get('/api/barang', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                m.sku,
                m.nama_barang,
                m.kategori_barang,
                i.national_inv,
                i.national_inv   AS stok_saat_ini,
                i.lead_time,
                i.in_transit_qty,
                i.forecast_3_month,
                i.forecast_6_month,
                i.forecast_9_month,
                i.sales_1_month,
                i.sales_3_month,
                i.sales_6_month,
                i.sales_9_month,
                i.min_bank,
                i.potential_issue,
                i.pieces_past_due,
                i.perf_6_month_avg,
                i.perf_12_month_avg,
                i.local_bo_qty,
                i.deck_risk,
                i.oe_constraint,
                i.ppap_risk,
                i.stop_auto_buy,
                i.rev_stop,
                i.updated_at
            FROM master_barang m
            JOIN mutasi_inventaris i ON m.sku = i.sku
            ORDER BY i.national_inv ASC;
        `);
        res.json(rows);
    } catch (err) {
        console.error('GET /api/barang error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data barang.' });
    }
});

// ---------------------------------------------------------------------------
// Routes: Prediksi — proxy ke ML service (Flask :5001)
// ---------------------------------------------------------------------------

/**
 * POST /api/predict
 * Prediksi 1 item. Frontend mengirim 21 fitur, divalidasi lalu di-proxy
 * ke Flask inference service. Tidak menulis ke database.
 */
app.post('/api/predict', async (req, res) => {
    // Validasi input
    const validationError = validateFeatures(req.body);
    if (validationError) {
        return res.status(400).json({ error: validationError, required_features: FEATURE_COLUMNS });
    }

    try {
        const response = await axios.post(`${ML_SERVICE_URL}/predict`, req.body, {
            timeout: 30000,
        });
        res.json(response.data);
    } catch (err) {
        handleMlError(err, res, 'POST /api/predict');
    }
});

/**
 * POST /api/predict/batch
 * Prediksi banyak item sekaligus dari request body JSON.
 * Tidak menulis ke database — dipakai frontend untuk preview cepat.
 */
app.post('/api/predict/batch', async (req, res) => {
    try {
        const response = await axios.post(`${ML_SERVICE_URL}/predict/batch`, req.body, {
            timeout: 120000,
        });
        res.json(response.data);
    } catch (err) {
        handleMlError(err, res, 'POST /api/predict/batch');
    }
});

/**
 * POST /api/predict/upload-csv
 * Upload file CSV, parse, lalu kirim ke ML service untuk batch predict.
 * Tidak menulis ke database — hasil dikembalikan langsung ke frontend.
 */
app.post('/api/predict/upload-csv', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Tidak ada file yang diupload.' });
        }

        const csvString = req.file.buffer.toString('utf-8');
        const rows = parseCSV(csvString);

        if (rows.length === 0) {
            return res.status(400).json({ error: 'File CSV kosong atau format tidak valid.' });
        }

        if (rows.length > 10000) {
            return res.status(400).json({ error: 'Maksimal 10.000 baris per upload.' });
        }

        // Validasi kolom CSV mengandung fitur model
        const csvCols = Object.keys(rows[0]);
        const missingFeatures = FEATURE_COLUMNS.filter(f => !csvCols.includes(f));
        if (missingFeatures.length > 0) {
            return res.status(400).json({
                error: `Kolom tidak ditemukan di CSV: ${missingFeatures.join(', ')}`,
                required_features: FEATURE_COLUMNS,
                found_columns: csvCols,
            });
        }

        // Kirim ke ML service
        const response = await axios.post(`${ML_SERVICE_URL}/predict/batch`, {
            data: rows,
        }, {
            timeout: 120000,
        });

        // Gabungkan identifiers (sku jika ada) ke hasil
        const { results, summary, threshold_used } = response.data;

        // Normalisasi: Flask baru pakai probability_backorder & backorder_percentage
        // Flask lama pakai probability & backorder_pct
        const enrichedResults = results.map((r, i) => {
            const prob = r.probability_backorder ?? r.probability ?? 0;
            return {
                ...r,
                probability_backorder: prob,
                probability: prob,
                sku: r.sku ?? rows[i].sku ?? rows[i].SKU ?? null,
                is_backorder: r.prediction === 1,
            };
        });

        const normalizedSummary = {
            ...summary,
            backorder_pct: summary.backorder_pct ?? summary.backorder_percentage
                ?? (summary.total > 0 ? (summary.backorder / summary.total) * 100 : 0),
        };

        res.json({
            results: enrichedResults,
            summary: normalizedSummary,
            threshold_used,
            rows_parsed: rows.length,
            filename: req.file.originalname,
        });
    } catch (err) {
        if (err.message === 'Hanya file CSV yang diizinkan.') {
            return res.status(400).json({ error: err.message });
        }
        handleMlError(err, res, 'POST /api/predict/upload-csv');
    }
});

/**
 * POST /api/predict/run-all
 * Menjalankan prediksi untuk SELURUH data di mutasi_inventaris,
 * lalu menyimpan hasilnya ke tabel log_prediksi (upsert per SKU).
 *
 * Alur:
 *   1. Baca semua baris mutasi_inventaris (21 fitur)
 *   2. POST ke /predict/batch di Flask service
 *   3. Batch upsert ke log_prediksi (batch insert, bukan satu-satu)
 *
 * Response: { summary, written, threshold_used }
 */
app.post('/api/predict/run-all', async (req, res) => {
    const client = await pool.connect();
    try {
        // 1. Ambil data inventaris
        const { rows: items } = await client.query(`
            SELECT sku, ${FEATURE_COLUMNS.join(', ')}
            FROM mutasi_inventaris;
        `);

        if (items.length === 0) {
            return res.status(404).json({ error: 'Tidak ada data di mutasi_inventaris.' });
        }

        // 2. Kirim ke ML service
        const response = await axios.post(`${ML_SERVICE_URL}/predict/batch`, {
            data: items,
        }, {
            timeout: 300000, // 5 menit untuk data besar
        });

        const { results, summary, threshold_used } = response.data;

        // 3. Batch upsert ke log_prediksi
        // Menggunakan UNNEST untuk insert batch — jauh lebih efisien dari loop
        await client.query('BEGIN');

        const BATCH_SIZE = 500;
        let written = 0;

        for (let offset = 0; offset < results.length; offset += BATCH_SIZE) {
            const batch = results.slice(offset, offset + BATCH_SIZE);
            const skus = [];
            const probs = [];
            const statuses = [];

            for (let i = 0; i < batch.length; i++) {
                const r = batch[i];
                const idx = offset + i;
            skus.push(r.sku ?? items[idx].sku);
                // Flask baru: probability_backorder; Flask lama: probability
                const prob = r.probability_backorder ?? r.probability ?? 0;
                probs.push(+(prob * 100).toFixed(2)); // 0–100
                statuses.push(r.prediction === 1);
            }

            await client.query(`
                INSERT INTO log_prediksi (sku, probabilitas_backorder, status_bahaya, tanggal_prediksi)
                SELECT * FROM UNNEST($1::varchar[], $2::numeric[], $3::boolean[],
                       (SELECT array_agg(NOW()) FROM generate_series(1, $4))::timestamp[])
                ON CONFLICT (sku)
                DO UPDATE SET
                    probabilitas_backorder = EXCLUDED.probabilitas_backorder,
                    status_bahaya          = EXCLUDED.status_bahaya,
                    tanggal_prediksi       = EXCLUDED.tanggal_prediksi;
            `, [skus, probs, statuses, batch.length]);

            written += batch.length;
        }

        await client.query('COMMIT');

        console.log(`run-all selesai: ${written} baris ditulis ke log_prediksi.`);
        res.json({ summary, written, threshold_used });

    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        handleMlError(err, res, 'POST /api/predict/run-all');
    } finally {
        client.release();
    }
});

/**
 * GET /api/predict/log
 * Mengambil hasil prediksi terbaru dari log_prediksi,
 * di-join dengan master_barang untuk nama & kategori.
 * Dipakai halaman Inventaris untuk kolom Status Prediksi.
 */
app.get('/api/predict/log', async (req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT
                l.sku,
                m.nama_barang,
                m.kategori_barang,
                l.probabilitas_backorder,
                l.status_bahaya       AS is_backorder,
                CASE
                    WHEN l.status_bahaya THEN 'Backorder'
                    ELSE 'Aman'
                END                   AS status,
                l.tanggal_prediksi
            FROM log_prediksi l
            LEFT JOIN master_barang m ON l.sku = m.sku
            ORDER BY l.probabilitas_backorder DESC;
        `);
        res.json(rows);
    } catch (err) {
        console.error('GET /api/predict/log error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil log prediksi.' });
    }
});

// ---------------------------------------------------------------------------
// Routes: Model Info
// ---------------------------------------------------------------------------

app.get('/api/model/info', async (req, res) => {
    try {
        const response = await axios.get(`${ML_SERVICE_URL}/model/info`, { timeout: 5000 });
        res.json(response.data);
    } catch (err) {
        handleMlError(err, res, 'GET /api/model/info');
    }
});

/**
 * GET /api/health
 * Health check gabungan: backend Express + PostgreSQL + ML service (Flask).
 */
app.get('/api/health', async (req, res) => {
    const health = { backend: 'ok', database: 'unknown', model_service: 'unknown' };

    try {
        await pool.query('SELECT 1');
        health.database = 'ok';
    } catch {
        health.database = 'error';
    }

    try {
        const resp = await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 3000 });
        health.model_service = resp.data.status || 'ok';
    } catch {
        health.model_service = 'error';
    }

    const allOk = Object.values(health).every(v => v === 'ok');
    res.status(allOk ? 200 : 503).json(health);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend API berjalan di http://localhost:${PORT}`);
    console.log(`ML service (Flask) diharapkan di ${ML_SERVICE_URL}`);
});