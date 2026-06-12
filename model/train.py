"""
Backorder Prediction Model - Training Pipeline
===============================================
Melatih Random Forest Classifier untuk memprediksi backorder produk.

Penggunaan:
    python train_model.py
    python train_model.py --train Training_BOP.csv --test Testing_BOP.csv
    python train_model.py --train data.xlsx --sample   # mode tes, split 80/20
    python train_model.py --tune                       # aktifkan hyperparameter search
    python train_model.py --smote                      # aktifkan SMOTE oversampling
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
from sklearn.ensemble import RandomForestClassifier
from sklearn.exceptions import UndefinedMetricWarning
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split
from imblearn.over_sampling import SMOTE

warnings.filterwarnings("ignore", category=UndefinedMetricWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

# ---------------------------------------------------------------------------
# Konfigurasi
# ---------------------------------------------------------------------------

RANDOM_STATE      = 42
TARGET_COLUMN     = "went_on_backorder"
DROP_COLUMNS      = ["sku"]
BINARY_MAP        = {"Yes": 1, "No": 0}
OUTPUT_DIR        = Path("output")
MODEL_FILENAME    = "rf_model.pkl"
METADATA_FILENAME = "rf_model_metadata.json"

# Sentinel values: placeholder sistem yg bukan angka nyata → ubah ke NaN
SENTINEL_VALUES = {
    "perf_6_month_avg":  -99,
    "perf_12_month_avg": -99,
}

EXPECTED_COLUMNS = {
    "national_inv", "lead_time", "in_transit_qty", "forecast_3_month",
    "forecast_6_month", "forecast_9_month", "sales_1_month", "sales_3_month",
    "sales_6_month", "sales_9_month", "min_bank", "potential_issue",
    "pieces_past_due", "perf_6_month_avg", "perf_12_month_avg",
    "local_bo_qty", "deck_risk", "oe_constraint", "ppap_risk",
    "stop_auto_buy", "rev_stop", TARGET_COLUMN,
}

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def setup_logging(log_level: str = "INFO") -> logging.Logger:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log_path = OUTPUT_DIR / f"training_{datetime.now():%Y%m%d_%H%M%S}.log"
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
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
# Load
# ---------------------------------------------------------------------------

def load_data(filepath: str) -> pd.DataFrame:
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"File tidak ditemukan: {path.resolve()}")

    logger.info("Membaca data dari: %s", path)
    ext = path.suffix.lower()
    if ext in {".xlsx", ".xls", ".xlsm"}:
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path, low_memory=False)

    logger.info("  -> %d baris, %d kolom berhasil dimuat.", *df.shape)

    missing_cols = EXPECTED_COLUMNS - set(df.columns)
    if missing_cols:
        raise ValueError(f"Kolom tidak ditemukan: {missing_cols}")
    return df

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------

def clean_data(df: pd.DataFrame, split_name: str = "data") -> pd.DataFrame:
    """
    1. Hapus duplikat
    2. Ganti sentinel value → NaN
    3. Imputasi NaN numerik dengan median
    4. Imputasi NaN kategorikal dengan 'No'
    """
    n_before = len(df)
    df = df.drop_duplicates()
    if (n_dup := n_before - len(df)):
        logger.warning("  [%s] %d baris duplikat dihapus.", split_name, n_dup)

    for col, sentinel in SENTINEL_VALUES.items():
        if col in df.columns:
            n = (df[col] == sentinel).sum()
            if n:
                df[col] = df[col].replace(sentinel, np.nan)
                logger.info("  [%s] '%s': %d sentinel (%s) → NaN.", split_name, col, n, sentinel)

    for col in df.select_dtypes(include="number").columns:
        n = df[col].isna().sum()
        if n:
            med = df[col].median()
            df[col] = df[col].fillna(med)
            logger.debug("  [%s] '%s': %d NaN → median %.4f.", split_name, col, n, med)

    for col in df.select_dtypes(include=["object", "str"]).columns:
        n = df[col].isna().sum()
        if n:
            df[col] = df[col].fillna("No")
            logger.debug("  [%s] '%s': %d NaN → 'No'.", split_name, col, n)

    logger.info("  [%s] Setelah pembersihan: %d baris tersisa.", split_name, len(df))
    return df

# ---------------------------------------------------------------------------
# Feature Extraction
# ---------------------------------------------------------------------------

def _map_binary_column(series: pd.Series) -> pd.Series:
    """
    Ubah kolom Yes/No → 1/0 secara eksplisit per kolom.
    Menggunakan map() bukan replace() agar kompatibel dengan pandas >= 2.0
    yang memperlakukan kolom 'Yes'/'No' sebagai tipe StringDtype, bukan object,
    sehingga .replace({'Yes': 1, 'No': 0}) tidak mengubah dtype dan kolom
    tetap dianggap non-numerik.
    """
    return series.map({"Yes": 1, "No": 0}).astype("Int64")


def extract_features(df: pd.DataFrame):
    X = df.drop(columns=DROP_COLUMNS + [TARGET_COLUMN], errors="ignore")
    y = df[TARGET_COLUMN].map(BINARY_MAP)

    if y.isna().any():
        bad = df[TARGET_COLUMN][y.isna()].unique()
        raise ValueError(f"Nilai tak dikenal di target: {bad}. Izin: {list(BINARY_MAP)}")

    # Identifikasi kolom Yes/No sebelum konversi
    binary_cols = [
        col for col in X.columns
        if X[col].dropna().isin(["Yes", "No"]).all() and X[col].dtype not in ["int64", "float64"]
    ]
    if binary_cols:
        for col in binary_cols:
            X[col] = _map_binary_column(X[col])
        logger.info("  Kolom Yes/No dikonversi (1/0): %s", binary_cols)

    # Konversi Int64 (nullable integer) → int64 biasa agar kompatibel dengan sklearn & SMOTE
    for col in X.select_dtypes(include="Int64").columns:
        X[col] = X[col].astype("int64")

    # Drop kolom yang masih non-numerik (jika ada kolom tak terduga)
    non_num = X.select_dtypes(exclude="number").columns.tolist()
    if non_num:
        logger.warning("Kolom non-numerik tidak dikenali, di-drop: %s", non_num)
        X = X.drop(columns=non_num)

    dist = dict(y.value_counts())
    logger.info("  Fitur: %d | Target → Aman(0): %s, Backorder(1): %s",
                X.shape[1], dist.get(0, 0), dist.get(1, 0))
    return X, y

# ---------------------------------------------------------------------------
# Evaluate
# ---------------------------------------------------------------------------

def evaluate_model(model, X_test: pd.DataFrame, y_test: pd.Series) -> dict:
    y_pred  = model.predict(X_test)
    proba   = model.predict_proba(X_test)
    # Ambil kolom probabilitas kelas positif (1); jika hanya 1 kelas → fallback
    y_proba = proba[:, 1] if proba.shape[1] >= 2 else proba[:, 0]

    only_one_class = y_test.nunique() < 2
    try:
        auc = round(roc_auc_score(y_test, y_proba), 4) if not only_one_class else None
    except Exception:
        auc = None

    metrics = {
        "accuracy":  round(accuracy_score(y_test, y_pred), 4),
        "precision": round(precision_score(y_test, y_pred, zero_division=0), 4),
        "recall":    round(recall_score(y_test, y_pred, zero_division=0), 4),
        "f1_score":  round(f1_score(y_test, y_pred, zero_division=0), 4),
        "roc_auc":   auc,
    }

    SEP = "=" * 55
    logger.info(SEP)
    logger.info("HASIL EVALUASI MODEL")
    logger.info(SEP)
    for k, v in metrics.items():
        logger.info("  %-15s : %s", k.upper(), f"{v:.4f}" if v is not None else "N/A")

    # Confusion matrix — robust terhadap jumlah kelas
    cm     = confusion_matrix(y_test, y_pred, labels=[0, 1])
    tn, fp = cm[0, 0], cm[0, 1]
    fn, tp = cm[1, 0], cm[1, 1]
    logger.info("-" * 55)
    logger.info("CONFUSION MATRIX")
    logger.info("  TN: %-6d  FP: %d", tn, fp)
    logger.info("  FN: %-6d  TP: %d", fn, tp)

    logger.info("-" * 55)
    logger.info("CLASSIFICATION REPORT")
    report = classification_report(
        y_test, y_pred,
        labels=[0, 1],
        target_names=["Aman (0)", "Backorder (1)"],
        zero_division=0,
    )
    for line in report.strip().splitlines():
        logger.info("  %s", line)
    logger.info(SEP)

    if hasattr(model, "feature_importances_"):
        imp = pd.Series(model.feature_importances_,
                        index=X_test.columns).sort_values(ascending=False)
        logger.info("TOP 10 FITUR TERPENTING")
        logger.info("-" * 55)
        for feat, score in imp.head(10).items():
            logger.info("  %-28s : %.4f", feat, score)
        logger.info(SEP)

    if only_one_class:
        logger.warning(
            "Data uji hanya mengandung 1 kelas → precision/recall/F1/AUC tidak representatif. "
            "Pastikan data testing memiliki sampel kedua kelas."
        )
    return metrics

# ---------------------------------------------------------------------------
# Tuning
# ---------------------------------------------------------------------------

def tune_hyperparameters(X_train: pd.DataFrame, y_train: pd.Series) -> dict:
    logger.info("Memulai hyperparameter tuning (RandomizedSearchCV, n_iter=30)...")
    param_dist = {
        "n_estimators":      [50, 100, 200, 300],
        "max_depth":         [None, 10, 20, 30],
        "min_samples_split": [2, 5, 10],
        "min_samples_leaf":  [1, 2, 4],
        "max_features":      ["sqrt", "log2"],
        "class_weight":      [None, "balanced"],
    }
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    search = RandomizedSearchCV(
        RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=-1),
        param_dist, n_iter=30, cv=cv, scoring="f1",
        n_jobs=-1, random_state=RANDOM_STATE, verbose=1,
    )
    search.fit(X_train, y_train)
    logger.info("Best CV F1 : %.4f", search.best_score_)
    logger.info("Best Params: %s", search.best_params_)
    return search.best_params_

# ---------------------------------------------------------------------------
# SMOTE
# ---------------------------------------------------------------------------

def apply_smote(X_train: pd.DataFrame, y_train: pd.Series):
    """
    Terapkan SMOTE (Synthetic Minority Over-sampling Technique) pada data training.

    SMOTE membuat sampel sintetis kelas minoritas (Backorder=1) dengan interpolasi
    antara sampel nyata yang berdekatan — bukan sekadar menduplikasi baris.

    Catatan: SMOTE hanya diterapkan pada X_train/y_train, TIDAK pada X_test/y_test.
    Menerapkan SMOTE ke data test akan mencemari evaluasi (data leakage).

    k_neighbors default=5; jika jumlah sampel minoritas < 6, otomatis dikurangi.
    """
    n_minority = int(y_train.sum())
    if n_minority < 2:
        logger.warning("SMOTE dilewati: kelas minoritas hanya %d sampel (butuh ≥ 2).", n_minority)
        return X_train, y_train

    k = min(5, n_minority - 1)
    logger.info("Menerapkan SMOTE (k_neighbors=%d)...", k)
    logger.info("  Sebelum SMOTE — Aman(0): %d, Backorder(1): %d",
                int((y_train == 0).sum()), n_minority)

    smote = SMOTE(k_neighbors=k, random_state=RANDOM_STATE)
    X_res, y_res = smote.fit_resample(X_train, y_train)
    X_res = pd.DataFrame(X_res, columns=X_train.columns)
    y_res = pd.Series(y_res, name=y_train.name)

    logger.info("  Sesudah SMOTE  — Aman(0): %d, Backorder(1): %d",
                int((y_res == 0).sum()), int((y_res == 1).sum()))
    return X_res, y_res



def save_artifacts(model, metrics: dict, params: dict, feature_names: list) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    model_path = OUTPUT_DIR / MODEL_FILENAME
    joblib.dump(model, model_path)
    logger.info("Model disimpan     : %s", model_path.resolve())

    metadata = {
        "trained_at":         datetime.now().isoformat(),
        "model_class":        type(model).__name__,
        "parameters":         params,
        "smote_applied":      getattr(model, "_smote_applied", False),
        "feature_names":      feature_names,
        "evaluation_metrics": metrics,
    }
    meta_path = OUTPUT_DIR / METADATA_FILENAME
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, default=str)
    logger.info("Metadata disimpan  : %s", meta_path.resolve())

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(args: argparse.Namespace) -> None:
    logger.info("=" * 55)
    logger.info("BACKORDER PREDICTION — TRAINING PIPELINE")
    logger.info("=" * 55)
    start = datetime.now()

    train_df = load_data(args.train)

    if args.sample:
        logger.info("Mode --sample: split 80/20 dari satu file.")
        train_df = clean_data(train_df, "all")
        X_all, y_all = extract_features(train_df)
        stratify = y_all if y_all.nunique() > 1 else None
        X_train, X_test, y_train, y_test = train_test_split(
            X_all, y_all, test_size=0.2,
            random_state=RANDOM_STATE, stratify=stratify,
        )
    else:
        test_df  = load_data(args.test)
        logger.info("Membersihkan data...")
        train_df = clean_data(train_df, "train")
        test_df  = clean_data(test_df,  "test")
        logger.info("Mengekstraksi fitur...")
        X_train, y_train = extract_features(train_df)
        X_test,  y_test  = extract_features(test_df)
        missing = set(X_train.columns) - set(X_test.columns)
        if missing:
            raise ValueError(f"Kolom di train tidak ada di test: {missing}")
        X_test = X_test[X_train.columns]

    logger.info("Split — Train: %d baris | Test: %d baris", len(X_train), len(X_test))

    # SMOTE — hanya pada data training
    if args.smote:
        X_train, y_train = apply_smote(X_train, y_train)

    if args.tune:
        params = tune_hyperparameters(X_train, y_train)
    else:
        params = {"n_estimators": 100, "max_depth": None, "class_weight": "balanced"}
        logger.info("Parameter model: %s", params)

    logger.info("Melatih model Random Forest...")
    model = RandomForestClassifier(random_state=RANDOM_STATE, n_jobs=-1, **params)
    model.fit(X_train, y_train)
    model._smote_applied = args.smote   # simpan flag untuk metadata
    logger.info("Training selesai.")

    metrics = evaluate_model(model, X_test, y_test)
    save_artifacts(model, metrics, params, X_train.columns.tolist())

    logger.info("Total waktu: %.1f detik", (datetime.now() - start).total_seconds())
    logger.info("Pipeline selesai.")

# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Training pipeline prediksi backorder.")
    p.add_argument("--train",  default="Training_BOP.csv",
                   help="File CSV/Excel training")
    p.add_argument("--test",   default="Testing_BOP.csv",
                   help="File CSV/Excel testing")
    p.add_argument("--tune",   action="store_true",
                   help="Aktifkan RandomizedSearchCV hyperparameter tuning")
    p.add_argument("--smote",  action="store_true",
                   help="Aktifkan SMOTE oversampling untuk menangani class imbalance")
    p.add_argument("--sample", action="store_true",
                   help="Mode tes: split 80/20 dari --train, tanpa file testing")
    main(p.parse_args())