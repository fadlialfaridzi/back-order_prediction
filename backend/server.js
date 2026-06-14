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

// Multer — untuk upload file CSV batch
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // max 10MB
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FLASK_URL = process.env.FLASK_URL || 'http://localhost:5001';

// Konek PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    max: 20,
});

// ---------------------------------------------------------------------------
// Routes: Inventaris
// ---------------------------------------------------------------------------

// GET /api/barang — data barang beserta stoknya
app.get('/api/barang', async (req, res) => {
    try {
        const query = `
            SELECT 
                m.sku, 
                m.nama_barang, 
                m.kategori_barang, 
                i.national_inv AS stok_saat_ini, 
                i.lead_time, 
                i.in_transit_qty
            FROM master_barang m
            JOIN mutasi_inventaris i ON m.sku = i.sku
            ORDER BY i.national_inv ASC;
        `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error('GET /api/barang error:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data barang.' });
    }
});

// ---------------------------------------------------------------------------
// Routes: Prediksi — proxy ke Flask sidecar
// ---------------------------------------------------------------------------

// POST /api/predict — prediksi 1 item
app.post('/api/predict', async (req, res) => {
    try {
        const response = await axios.post(`${FLASK_URL}/predict`, req.body, {
            timeout: 30000,
        });
        res.json(response.data);
    } catch (err) {
        if (err.response) {
            // Flask mengembalikan error
            return res.status(err.response.status).json(err.response.data);
        }
        console.error('POST /api/predict error:', err.message);
        res.status(502).json({
            error: 'Model service tidak tersedia.',
            detail: err.message,
        });
    }
});

// POST /api/predict/batch — prediksi batch (JSON array)
app.post('/api/predict/batch', async (req, res) => {
    try {
        const response = await axios.post(`${FLASK_URL}/predict/batch`, req.body, {
            timeout: 120000, // 2 menit untuk batch besar
        });
        res.json(response.data);
    } catch (err) {
        if (err.response) {
            return res.status(err.response.status).json(err.response.data);
        }
        console.error('POST /api/predict/batch error:', err.message);
        res.status(502).json({
            error: 'Model service tidak tersedia.',
            detail: err.message,
        });
    }
});

// ---------------------------------------------------------------------------
// Routes: Model Info
// ---------------------------------------------------------------------------

// GET /api/model/info — metadata model (fitur, threshold, metrik)
app.get('/api/model/info', async (req, res) => {
    try {
        const response = await axios.get(`${FLASK_URL}/model/info`, {
            timeout: 5000,
        });
        res.json(response.data);
    } catch (err) {
        console.error('GET /api/model/info error:', err.message);
        res.status(502).json({
            error: 'Model service tidak tersedia.',
            detail: err.message,
        });
    }
});

// GET /api/health — health check gabungan
app.get('/api/health', async (req, res) => {
    const health = {
        backend: 'ok',
        database: 'unknown',
        model_service: 'unknown',
    };

    // Check database
    try {
        await pool.query('SELECT 1');
        health.database = 'ok';
    } catch {
        health.database = 'error';
    }

    // Check Flask sidecar
    try {
        const resp = await axios.get(`${FLASK_URL}/health`, { timeout: 3000 });
        health.model_service = resp.data.status || 'ok';
    } catch {
        health.model_service = 'error';
    }

    const allOk = Object.values(health).every(v => v === 'ok');
    res.status(allOk ? 200 : 503).json(health);
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend API berjalan di http://localhost:${PORT}`);
    console.log(`Flask sidecar diharapkan di ${FLASK_URL}`);
});