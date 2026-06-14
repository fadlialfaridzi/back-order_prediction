"""
Backorder Prediction — Inference Script
========================================
Memprediksi status backorder untuk data baru menggunakan rf_model.pkl
dan threshold optimal yang tersimpan di rf_model_metadata.json.

Penggunaan:
    python predict.py --input data_baru.csv
    python predict.py --input data_baru.csv --output hasil_prediksi.csv
    python predict.py --input data_baru.xlsx --threshold 0.20   # override threshold

Input:
    File CSV/Excel berisi kolom-kolom fitur (tanpa kolom target
    'went_on_backorder' — kolom ini tidak dibutuhkan untuk prediksi).
    Kolom 'sku' opsional, jika ada akan disertakan di output sebagai identifier.

Output:
    File CSV dengan kolom tambahan:
      - probabilitas_backorder : skor 0.0-1.0 dari model
      - prediksi               : 0 (Aman) atau 1 (Backorder), berdasarkan threshold
      - status                 : label teks "Aman" / "Backorder"
"""

import argparse
import json
import logging
import sys
import warnings
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Konfigurasi
# ---------------------------------------------------------------------------

TARGET_COLUMN  = "went_on_backorder"
DROP_COLUMNS   = ["sku"]
SENTINEL_VALUES = {"perf_6_month_avg": -99, "perf_12_month_avg": -99}
OUTPUT_DIR     = Path("output")
MODEL_PATH     = OUTPUT_DIR / "rf_model.pkl"
METADATA_PATH  = OUTPUT_DIR / "rf_model_metadata.json"
DEFAULT_THRESHOLD = 0.5  # fallback jika metadata tidak punya optimal_threshold

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log_path = OUTPUT_DIR / f"predict_{datetime.now():%Y%m%d_%H%M%S}.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path, encoding="utf-8"),
        ],
    )
    return logging.getLogger(__name__)

logger = setup_logging()

# ---------------------------------------------------------------------------
# Load model & metadata
# ---------------------------------------------------------------------------

def load_model_and_metadata(model_path: Path, metadata_path: Path):
    """
    Load model .pkl dan metadata .json.
    Mengembalikan (model, feature_names, optimal_threshold).
    """
    if not model_path.exists():
        raise FileNotFoundError(f"Model tidak ditemukan: {model_path.resolve()}")

    model = joblib.load(model_path)
    logger.info("Model dimuat dari: %s", model_path.resolve())

    feature_names = None
    threshold = DEFAULT_THRESHOLD

    if metadata_path.exists():
        with open(metadata_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        feature_names = meta.get("feature_names")
        threshold = meta.get("optimal_threshold", DEFAULT_THRESHOLD)
        logger.info("Metadata dimuat: %d fitur, threshold=%.2f", len(feature_names or []), threshold)
    else:
        logger.warning("Metadata tidak ditemukan, menggunakan threshold default %.2f", threshold)

    if not feature_names:
        if hasattr(model, "feature_names_in_"):
            feature_names = list(model.feature_names_in_)
        else:
            raise ValueError("Nama fitur tidak ditemukan di metadata maupun model.")

    return model, feature_names, threshold

# ---------------------------------------------------------------------------
# Load & preprocess data baru
# ---------------------------------------------------------------------------

def load_input_data(filepath: str) -> pd.DataFrame:
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"File input tidak ditemukan: {path.resolve()}")

    ext = path.suffix.lower()
    df  = pd.read_excel(path) if ext in {".xlsx", ".xls", ".xlsm"} else pd.read_csv(path, low_memory=False)
    logger.info("Data input dimuat: %d baris, %d kolom", *df.shape)
    return df


def preprocess_for_prediction(df: pd.DataFrame, feature_names: list) -> pd.DataFrame:
    """
    Bersihkan dan selaraskan data input agar sesuai dengan fitur yang
    digunakan saat training. Logika identik dengan train_model.py /
    threshold_tuning.py agar konsisten.
    """
    df = df.copy()

    # 1. Sentinel → NaN
    for col, val in SENTINEL_VALUES.items():
        if col in df.columns:
            n = (df[col] == val).sum()
            if n:
                df[col] = df[col].replace(val, np.nan)
                logger.info("  '%s': %d sentinel → NaN", col, n)

    # 2. Imputasi median untuk kolom numerik
    for col in df.select_dtypes(include="number").columns:
        if df[col].isna().any():
            median_val = df[col].median()
            df[col] = df[col].fillna(median_val)

    # 3. Buang kolom yang tidak dipakai (sku, target jika ada)
    X = df.drop(columns=DROP_COLUMNS + [TARGET_COLUMN], errors="ignore")

    # 4. Konversi kolom Yes/No → 1/0
    binary_cols = [
        c for c in X.columns
        if X[c].dtype not in ["int64", "float64", "int32", "float32"]
        and not X[c].dropna().empty
        and X[c].dropna().isin(["Yes", "No"]).all()
    ]
    for col in binary_cols:
        mapped = X[col].map({"Yes": 1, "No": 0})
        n_unknown = int(mapped.isna().sum())
        if n_unknown:
            logger.warning("  Kolom '%s': %d nilai tak dikenal diisi 0.", col, n_unknown)
            mapped = mapped.fillna(0)
        X[col] = mapped.astype("int64")

    if binary_cols:
        logger.info("  Kolom Yes/No dikonversi (1/0): %s", binary_cols)

    # 5. Validasi kelengkapan fitur
    missing = set(feature_names) - set(X.columns)
    if missing:
        raise ValueError(
            f"Kolom berikut dibutuhkan model tapi tidak ada di data input: {missing}"
        )

    extra = set(X.columns) - set(feature_names)
    if extra:
        logger.info("  Kolom ekstra (tidak digunakan model): %s", sorted(extra))

    # 6. Selaraskan urutan kolom dengan saat training
    X = X[feature_names]

    # 7. Pastikan semua numerik
    non_num = X.select_dtypes(exclude="number").columns.tolist()
    if non_num:
        raise ValueError(f"Kolom berikut masih non-numerik setelah preprocessing: {non_num}")

    logger.info("  Fitur siap: %d kolom, %d baris.", X.shape[1], len(X))
    return X

# ---------------------------------------------------------------------------
# Prediksi
# ---------------------------------------------------------------------------

def predict(model, X: pd.DataFrame, threshold: float) -> pd.DataFrame:
    """
    Hitung probabilitas dan prediksi biner berdasarkan threshold.

    Returns
    -------
    pd.DataFrame dengan kolom: probabilitas_backorder, prediksi, status
    """
    proba = model.predict_proba(X)
    y_proba = proba[:, 1] if proba.shape[1] >= 2 else proba[:, 0]
    y_pred  = (y_proba >= threshold).astype(int)

    result = pd.DataFrame({
        "probabilitas_backorder": np.round(y_proba, 4),
        "prediksi": y_pred,
        "status": np.where(y_pred == 1, "Backorder", "Aman"),
    })
    return result

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(args: argparse.Namespace) -> None:
    logger.info("=" * 55)
    logger.info("BACKORDER PREDICTION — INFERENCE")
    logger.info("=" * 55)
    start = datetime.now()

    # 1. Load model & metadata
    model, feature_names, meta_threshold = load_model_and_metadata(
        Path(args.model), Path(args.metadata)
    )
    threshold = args.threshold if args.threshold is not None else meta_threshold
    logger.info("Threshold yang digunakan: %.2f%s",
                 threshold, " (override manual)" if args.threshold is not None else " (dari metadata)")

    # 2. Load data input
    df_input = load_input_data(args.input)

    # 3. Preprocess
    logger.info("Mempersiapkan data untuk prediksi...")
    X = preprocess_for_prediction(df_input, feature_names)

    # 4. Prediksi
    logger.info("Menjalankan prediksi pada %d baris...", len(X))
    result = predict(model, X, threshold)

    # 5. Gabungkan dengan identifier (sku) dan kolom asli jika diminta
    output_df = df_input.copy()
    for col in result.columns:
        output_df[col] = result[col].values

    # 6. Ringkasan
    n_total     = len(output_df)
    n_backorder = int((result["prediksi"] == 1).sum())
    logger.info("-" * 55)
    logger.info("RINGKASAN HASIL PREDIKSI")
    logger.info("-" * 55)
    logger.info("  Total baris        : %d", n_total)
    logger.info("  Diprediksi Backorder : %d (%.2f%%)", n_backorder, 100 * n_backorder / n_total)
    logger.info("  Diprediksi Aman      : %d (%.2f%%)", n_total - n_backorder, 100 * (n_total - n_backorder) / n_total)

    # Distribusi probabilitas untuk yang diprediksi backorder
    if n_backorder:
        probs = result.loc[result["prediksi"] == 1, "probabilitas_backorder"]
        logger.info("  Probabilitas backorder — min: %.3f | median: %.3f | max: %.3f",
                     probs.min(), probs.median(), probs.max())
    logger.info("-" * 55)

    # 7. Simpan output
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.suffix.lower() in {".xlsx", ".xls"}:
        output_df.to_excel(out_path, index=False)
    else:
        output_df.to_csv(out_path, index=False)
    logger.info("Hasil disimpan ke: %s", out_path.resolve())

    # 8. Tampilkan contoh hasil dengan prioritas tertinggi
    if n_backorder:
        logger.info("-" * 55)
        logger.info("TOP 10 ITEM DENGAN RISIKO BACKORDER TERTINGGI")
        logger.info("-" * 55)
        top10 = output_df[output_df["prediksi"] == 1].sort_values(
            "probabilitas_backorder", ascending=False
        ).head(10)
        cols_to_show = [c for c in ["sku", "national_inv", "probabilitas_backorder", "status"] if c in top10.columns]
        for _, row in top10.iterrows():
            logger.info("  %s", " | ".join(f"{c}: {row[c]}" for c in cols_to_show))
        logger.info("-" * 55)

    logger.info("Total waktu: %.1f detik", (datetime.now() - start).total_seconds())
    logger.info("Pipeline selesai.")

# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Prediksi backorder dari data baru.")
    p.add_argument("--input",  required=True,
                   help="File CSV/Excel berisi data baru (fitur tanpa kolom target)")
    p.add_argument("--output", default="output/predictions.csv",
                   help="Path file hasil prediksi (default: output/predictions.csv)")
    p.add_argument("--model",  default=str(MODEL_PATH),
                   help=f"Path ke model (default: {MODEL_PATH})")
    p.add_argument("--metadata", default=str(METADATA_PATH),
                   help=f"Path ke metadata (default: {METADATA_PATH})")
    p.add_argument("--threshold", type=float, default=None,
                   help="Override threshold manual (0.0-1.0). Default: ambil dari metadata.")
    main(p.parse_args())