"""
Threshold Tuning untuk Backorder Prediction
============================================
Menemukan threshold probabilitas optimal dari rf_model.pkl yang sudah ada
tanpa perlu training ulang.

Penggunaan:
    python threshold_tuning.py
    python threshold_tuning.py --test Testing_BOP.csv --model output/rf_model.pkl
    python threshold_tuning.py --target-recall 0.5   # cari threshold untuk recall >= 50%
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
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)

warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# Konfigurasi
# ---------------------------------------------------------------------------

TARGET_COLUMN  = "went_on_backorder"
DROP_COLUMNS   = ["sku"]
BINARY_MAP     = {"Yes": 1, "No": 0}
SENTINEL_VALUES = {"perf_6_month_avg": -99, "perf_12_month_avg": -99}
OUTPUT_DIR     = Path("output")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging() -> logging.Logger:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log_path = OUTPUT_DIR / f"threshold_tuning_{datetime.now():%Y%m%d_%H%M%S}.log"
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
# Load & Preprocess (ringkas — sama logikanya dengan train_model.py)
# ---------------------------------------------------------------------------

def load_and_prepare(filepath: str, feature_names: list):
    """Load data testing, bersihkan, dan selaraskan fitur dengan model."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"File tidak ditemukan: {path.resolve()}")

    ext = path.suffix.lower()
    df  = pd.read_excel(path) if ext in {".xlsx", ".xls"} else pd.read_csv(path, low_memory=False)
    logger.info("Data dimuat: %d baris, %d kolom", *df.shape)

    # Sentinel → NaN
    for col, val in SENTINEL_VALUES.items():
        if col in df.columns:
            n = (df[col] == val).sum()
            if n:
                df[col] = df[col].replace(val, np.nan)
                logger.info("  '%s': %d sentinel → NaN", col, n)

    # Imputasi median
    for col in df.select_dtypes(include="number").columns:
        if df[col].isna().any():
            df[col] = df[col].fillna(df[col].median())

    # Target
    y = df[TARGET_COLUMN].map(BINARY_MAP)

    # Drop baris yang nilai targetnya tidak dikenal (bukan Yes/No)
    n_bad = int(y.isna().sum())
    if n_bad:
        logger.warning(
            "  %d baris dengan nilai target tak dikenal di '%s' → dihapus.",
            n_bad, TARGET_COLUMN
        )
        mask = y.notna()
        df   = df[mask].reset_index(drop=True)
        y    = y[mask].reset_index(drop=True)

    # Fitur
    X = df.drop(columns=DROP_COLUMNS + [TARGET_COLUMN], errors="ignore")

    # Konversi Yes/No
    # Deteksi kolom non-numerik yang seluruh nilai non-null-nya adalah Yes atau No
    binary_cols = [
        c for c in X.columns
        if X[c].dtype not in ["int64", "float64", "int32", "float32"]
        and not X[c].dropna().empty
        and X[c].dropna().isin(["Yes", "No"]).all()
    ]
    for col in binary_cols:
        # Isi NaN dengan 0 ("No") sebelum cast — mencegah "cannot convert NA to integer"
        mapped = X[col].map({"Yes": 1, "No": 0})
        n_unknown = int(mapped.isna().sum())
        if n_unknown:
            logger.warning(
                "  Kolom '%s': %d nilai tak dikenal (bukan Yes/No) diisi 0.", col, n_unknown
            )
            mapped = mapped.fillna(0)
        X[col] = mapped.astype("int64")

    # Selaraskan kolom dengan fitur model
    missing = set(feature_names) - set(X.columns)
    if missing:
        raise ValueError(f"Kolom di model tidak ada di data test: {missing}")
    X = X[feature_names]

    logger.info(
        "Fitur siap: %d | Target — Aman(0): %d, Backorder(1): %d",
        X.shape[1], int((y == 0).sum()), int((y == 1).sum())
    )
    return X, y

# ---------------------------------------------------------------------------
# Analisis Threshold
# ---------------------------------------------------------------------------

def analyze_thresholds(y_true: pd.Series, y_proba: np.ndarray) -> pd.DataFrame:
    """
    Hitung precision, recall, F1, dan TP/FP/FN untuk setiap nilai threshold
    dari 0.05 sampai 0.70 dengan step 0.05.
    """
    thresholds = np.arange(0.05, 0.71, 0.05)
    rows = []
    for t in thresholds:
        y_pred = (y_proba >= t).astype(int)
        cm     = confusion_matrix(y_true, y_pred, labels=[0, 1])
        tn, fp, fn, tp = cm.ravel()
        rows.append({
            "threshold": round(float(t), 2),
            "precision": round(precision_score(y_true, y_pred, zero_division=0), 4),
            "recall":    round(recall_score(y_true, y_pred, zero_division=0), 4),
            "f1":        round(f1_score(y_true, y_pred, zero_division=0), 4),
            "accuracy":  round(accuracy_score(y_true, y_pred), 4),
            "tp": int(tp), "fp": int(fp),
            "fn": int(fn), "tn": int(tn),
        })
    return pd.DataFrame(rows)

def find_optimal_thresholds(df: pd.DataFrame) -> dict:
    """
    Temukan threshold optimal dari tiga sudut pandang berbeda:
      1. Maksimum F1-score
      2. Maksimum recall dengan precision >= 10%
      3. Titik keseimbangan precision ≈ recall
    """
    # 1. Maks F1
    idx_f1   = df["f1"].idxmax()
    best_f1  = df.loc[idx_f1]

    # 2. Maks recall dengan precision >= 10%
    candidate = df[df["precision"] >= 0.10]
    if not candidate.empty:
        idx_rec  = candidate["recall"].idxmax()
        best_rec = candidate.loc[idx_rec]
    else:
        best_rec = best_f1

    # 3. Precision ≈ recall (titik persilangan)
    df["gap"] = (df["precision"] - df["recall"]).abs()
    idx_bal   = df["gap"].idxmin()
    best_bal  = df.loc[idx_bal]

    return {
        "max_f1":       best_f1,
        "max_recall":   best_rec,
        "balanced":     best_bal,
    }

# ---------------------------------------------------------------------------
# Laporan
# ---------------------------------------------------------------------------

def print_threshold_table(df: pd.DataFrame) -> None:
    SEP = "=" * 80
    logger.info(SEP)
    logger.info("TABEL THRESHOLD — PRECISION / RECALL / F1")
    logger.info(SEP)
    logger.info(
        "  %-10s %-12s %-12s %-10s %-8s %-8s %-8s",
        "Threshold", "Precision", "Recall", "F1", "TP", "FP", "FN"
    )
    logger.info("-" * 80)
    for _, r in df.iterrows():
        marker = " <-- default" if r["threshold"] == 0.5 else ""
        logger.info(
            "  %-10.2f %-12.4f %-12.4f %-10.4f %-8d %-8d %-8d%s",
            r["threshold"], r["precision"], r["recall"],
            r["f1"], r["tp"], r["fp"], r["fn"], marker
        )
    logger.info(SEP)

def print_recommendation(opts: dict, df: pd.DataFrame) -> None:
    SEP = "=" * 80
    logger.info(SEP)
    logger.info("REKOMENDASI THRESHOLD")
    logger.info(SEP)

    labels = {
        "max_f1":     "Maks F1-score        (seimbang precision & recall)",
        "max_recall": "Maks recall          (prioritas: jangan lewatkan backorder)",
        "balanced":   "Balanced             (precision ≈ recall)",
    }
    for key, label in labels.items():
        r = opts[key]
        logger.info("  %s", label)
        logger.info(
            "    Threshold: %.2f | Precision: %.4f | Recall: %.4f | F1: %.4f | TP: %d | FP: %d | FN: %d",
            r["threshold"], r["precision"], r["recall"], r["f1"],
            int(r["tp"]), int(r["fp"]), int(r["fn"])
        )
        logger.info("")

    # Konteks bisnis
    logger.info("-" * 80)
    logger.info("PANDUAN MEMILIH THRESHOLD UNTUK BACKORDER:")
    logger.info("  Recall tinggi  = tidak melewatkan backorder nyata,")
    logger.info("                   tapi lebih banyak false alarm (tim ops perlu verifikasi lebih).")
    logger.info("  Precision tinggi = sedikit false alarm,")
    logger.info("                   tapi lebih banyak backorder nyata yang terlewat.")
    logger.info("  Rekomendasi umum: gunakan threshold 'Maks recall' jika")
    logger.info("  biaya kehabisan stok > biaya verifikasi manual false alarm.")
    logger.info(SEP)

def evaluate_at_threshold(y_true, y_proba, threshold: float) -> None:
    y_pred = (y_proba >= threshold).astype(int)
    cm     = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn, tp = cm.ravel()

    SEP = "=" * 55
    logger.info(SEP)
    logger.info("EVALUASI DETAIL — threshold = %.2f", threshold)
    logger.info(SEP)
    logger.info("  ACCURACY  : %.4f", accuracy_score(y_true, y_pred))
    logger.info("  PRECISION : %.4f", precision_score(y_true, y_pred, zero_division=0))
    logger.info("  RECALL    : %.4f", recall_score(y_true, y_pred, zero_division=0))
    logger.info("  F1-SCORE  : %.4f", f1_score(y_true, y_pred, zero_division=0))
    logger.info("  ROC-AUC   : %.4f", roc_auc_score(y_true, y_proba))
    logger.info("-" * 55)
    logger.info("  CONFUSION MATRIX")
    logger.info("  TN: %-8d  FP: %d", tn, fp)
    logger.info("  FN: %-8d  TP: %d", fn, tp)
    logger.info("-" * 55)
    report = classification_report(
        y_true, y_pred,
        labels=[0, 1],
        target_names=["Aman (0)", "Backorder (1)"],
        zero_division=0,
    )
    for line in report.strip().splitlines():
        logger.info("  %s", line)
    logger.info(SEP)

# ---------------------------------------------------------------------------
# Simpan hasil
# ---------------------------------------------------------------------------

def save_results(
    threshold_df: pd.DataFrame,
    opts: dict,
    chosen_threshold: float,
    model_path: str,
) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    csv_path = OUTPUT_DIR / "threshold_analysis.csv"
    threshold_df.to_csv(csv_path, index=False)
    logger.info("Tabel threshold disimpan : %s", csv_path.resolve())

    result = {
        "generated_at":     datetime.now().isoformat(),
        "source_model":     str(model_path),
        "chosen_threshold": chosen_threshold,
        "recommendations": {
            k: {
                "threshold": float(v["threshold"]),
                "precision": float(v["precision"]),
                "recall":    float(v["recall"]),
                "f1":        float(v["f1"]),
                "tp":        int(v["tp"]),
                "fp":        int(v["fp"]),
                "fn":        int(v["fn"]),
            }
            for k, v in opts.items()
        },
    }
    json_path = OUTPUT_DIR / "threshold_result.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    logger.info("Hasil JSON disimpan     : %s", json_path.resolve())

    # Simpan metadata model yang diupdate dengan threshold baru
    meta_path = OUTPUT_DIR / "rf_model_metadata.json"
    if meta_path.exists():
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        meta["optimal_threshold"] = chosen_threshold
        meta["threshold_tuned_at"] = datetime.now().isoformat()
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
        logger.info("rf_model_metadata.json diperbarui dengan threshold baru.")

# ---------------------------------------------------------------------------
# Predict helper — untuk dipakai di script lain setelah tuning
# ---------------------------------------------------------------------------

def predict_with_threshold(model, X: pd.DataFrame, threshold: float) -> np.ndarray:
    """
    Fungsi helper: prediksi dengan threshold kustom.
    Bisa diimpor dari script predict.py nantinya.

    Contoh:
        from threshold_tuning import predict_with_threshold
        predictions = predict_with_threshold(model, X_new, threshold=0.20)
    """
    proba = model.predict_proba(X)[:, 1]
    return (proba >= threshold).astype(int)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(args: argparse.Namespace) -> None:
    logger.info("=" * 55)
    logger.info("THRESHOLD TUNING — BACKORDER PREDICTION")
    logger.info("=" * 55)
    start = datetime.now()

    # 1. Load model
    model_path = Path(args.model)
    if not model_path.exists():
        raise FileNotFoundError(f"Model tidak ditemukan: {model_path.resolve()}")
    model = joblib.load(model_path)
    logger.info("Model dimuat dari: %s", model_path.resolve())

    # Ambil nama fitur dari metadata jika ada
    meta_path = OUTPUT_DIR / "rf_model_metadata.json"
    feature_names = None
    if meta_path.exists():
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        feature_names = meta.get("feature_names")
        logger.info("Nama fitur dimuat dari metadata (%d fitur).", len(feature_names))
    if not feature_names:
        feature_names = list(model.feature_names_in_) if hasattr(model, "feature_names_in_") else None
    if not feature_names:
        raise ValueError(
            "Nama fitur tidak ditemukan di metadata maupun model. "
            "Pastikan output/rf_model_metadata.json ada."
        )

    # 2. Load & siapkan data test
    logger.info("Memuat data testing...")
    X_test, y_test = load_and_prepare(args.test, feature_names)

    # 3. Hitung probabilitas
    logger.info("Menghitung probabilitas prediksi...")
    y_proba = model.predict_proba(X_test)[:, 1]

    # 4. Analisis semua threshold
    logger.info("Menganalisis %d nilai threshold...", len(np.arange(0.05, 0.71, 0.05)))
    df_thresh = analyze_thresholds(y_test, y_proba)
    print_threshold_table(df_thresh)

    # 5. Temukan optimal
    opts = find_optimal_thresholds(df_thresh)
    print_recommendation(opts, df_thresh)

    # 6. Tentukan threshold yang akan dipakai
    if args.set_threshold is not None:
        # Pilih threshold spesifik secara manual, ambil baris terdekat untuk evaluasi detail
        chosen = float(args.set_threshold)
        closest_idx = (df_thresh["threshold"] - chosen).abs().idxmin()
        closest_row = df_thresh.loc[closest_idx]
        if abs(closest_row["threshold"] - chosen) > 1e-9:
            logger.info(
                "Threshold %.2f dipilih manual (baris tabel terdekat: %.2f).",
                chosen, closest_row["threshold"]
            )
        else:
            logger.info("Threshold %.2f dipilih manual.", chosen)
    elif args.target_recall:
        # Cari threshold dengan recall >= target, dengan precision maksimal
        target = args.target_recall
        candidates = df_thresh[df_thresh["recall"] >= target]
        if candidates.empty:
            logger.warning(
                "Tidak ada threshold yang mencapai recall >= %.2f. "
                "Menggunakan threshold max-recall.", target
            )
            chosen = float(opts["max_recall"]["threshold"])
        else:
            chosen = float(candidates.loc[candidates["precision"].idxmax(), "threshold"])
        logger.info("Threshold dipilih untuk recall >= %.2f : %.2f", target, chosen)
    else:
        # Default: gunakan threshold max-recall (prioritas bisnis backorder)
        chosen = float(opts["max_recall"]["threshold"])
        logger.info("Threshold dipilih (max recall) : %.2f", chosen)

    # 7. Evaluasi detail di threshold terpilih
    evaluate_at_threshold(y_test, y_proba, chosen)

    # 8. Simpan
    save_results(df_thresh, opts, chosen, str(model_path))

    logger.info("Total waktu: %.1f detik", (datetime.now() - start).total_seconds())
    logger.info("Pipeline selesai.")
    logger.info("")
    logger.info("Cara pakai threshold baru di predict.py:")
    logger.info("  from threshold_tuning import predict_with_threshold")
    logger.info("  predictions = predict_with_threshold(model, X_new, threshold=%.2f)", chosen)

# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Threshold tuning untuk rf_model.pkl.")
    p.add_argument("--test",  default="Testing_BOP.csv",
                   help="File CSV/Excel testing (default: Testing_BOP.csv)")
    p.add_argument("--model", default="output/rf_model.pkl",
                   help="Path ke model (default: output/rf_model.pkl)")
    p.add_argument("--target-recall", type=float, default=None,
                   help="Target recall minimum (0.0–1.0). Jika tidak diisi, pakai max-recall.")
    p.add_argument("--set-threshold", type=float, default=None,
                   help="Set threshold spesifik secara manual (0.0–1.0), mengabaikan --target-recall.")
    main(p.parse_args())