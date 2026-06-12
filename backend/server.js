const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Konek PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Jalur API: Minta data barang beserta stoknya
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
        console.error(err.message);
        res.status(500).json({ error: 'Gudang lagi bermasalah!' });
    }
});

// Nyalakan Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Pelayan sudah siap beroperasi di port ${PORT}`);
});