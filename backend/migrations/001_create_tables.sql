-- ============================================
-- Migrasi #001: Buat Tabel Utama
-- ============================================
-- Database: db_inventaris_pabrik
-- Jalankan: psql -U postgres -d db_inventaris_pabrik -f migrations/001_create_tables.sql

-- 1. Tabel master_barang — data master produk/item
CREATE TABLE IF NOT EXISTS master_barang (
    sku               VARCHAR(50)   PRIMARY KEY,
    nama_barang       VARCHAR(255)  NOT NULL,
    kategori_barang   VARCHAR(100),
    created_at        TIMESTAMP     DEFAULT NOW(),
    updated_at        TIMESTAMP     DEFAULT NOW()
);

-- 2. Tabel mutasi_inventaris — data inventaris + 21 fitur model
CREATE TABLE IF NOT EXISTS mutasi_inventaris (
    sku                 VARCHAR(50)   PRIMARY KEY REFERENCES master_barang(sku) ON DELETE CASCADE,
    national_inv        NUMERIC       DEFAULT 0,
    lead_time           NUMERIC       DEFAULT 0,
    in_transit_qty      NUMERIC       DEFAULT 0,
    forecast_3_month    NUMERIC       DEFAULT 0,
    forecast_6_month    NUMERIC       DEFAULT 0,
    forecast_9_month    NUMERIC       DEFAULT 0,
    sales_1_month       NUMERIC       DEFAULT 0,
    sales_3_month       NUMERIC       DEFAULT 0,
    sales_6_month       NUMERIC       DEFAULT 0,
    sales_9_month       NUMERIC       DEFAULT 0,
    min_bank            NUMERIC       DEFAULT 0,
    potential_issue      NUMERIC       DEFAULT 0,
    pieces_past_due     NUMERIC       DEFAULT 0,
    perf_6_month_avg    NUMERIC       DEFAULT -99,
    perf_12_month_avg   NUMERIC       DEFAULT -99,
    local_bo_qty        NUMERIC       DEFAULT 0,
    deck_risk           NUMERIC       DEFAULT 0,
    oe_constraint       NUMERIC       DEFAULT 0,
    ppap_risk           NUMERIC       DEFAULT 0,
    stop_auto_buy       NUMERIC       DEFAULT 0,
    rev_stop            NUMERIC       DEFAULT 0,
    updated_at          TIMESTAMP     DEFAULT NOW()
);

-- 3. Tabel log_prediksi — hasil prediksi backorder per SKU
CREATE TABLE IF NOT EXISTS log_prediksi (
    sku                       VARCHAR(50)   PRIMARY KEY REFERENCES master_barang(sku) ON DELETE CASCADE,
    probabilitas_backorder    NUMERIC(5,2)  NOT NULL,
    status_bahaya             BOOLEAN       NOT NULL DEFAULT FALSE,
    tanggal_prediksi          TIMESTAMP     DEFAULT NOW()
);

-- Index untuk query umum
CREATE INDEX IF NOT EXISTS idx_log_prediksi_prob
    ON log_prediksi (probabilitas_backorder DESC);

CREATE INDEX IF NOT EXISTS idx_mutasi_inv_national
    ON mutasi_inventaris (national_inv ASC);

-- Trigger auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_master_barang_updated
    BEFORE UPDATE ON master_barang
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER trg_mutasi_inventaris_updated
    BEFORE UPDATE ON mutasi_inventaris
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
