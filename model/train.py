"""
Training pipeline Random Forest untuk prediksi backorder.

Desain utama:
- path selalu relatif terhadap lokasi file ini;
- validasi schema dan nilai input;
- split train/validation sebelum imputasi;
- preprocessing disimpan bersama model dalam sklearn Pipeline;
- hyperparameter tuning memakai Average Precision (PR-AUC);
- tuning dilakukan pada stratified sample agar tetap realistis untuk dataset besar;
- validation set disimpan khusus untuk threshold_tuning.py;
- Testing_BOP.csv tidak disentuh pada tahap training.

Contoh:
    python train.py
    python train.py --no-tune
    python train.py --n-iter 25 --search-sample-size 300000
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import RandomizedSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

warnings.filterwarnings("ignore", category=FutureWarning)

# ---------------------------------------------------------------------------
# Konfigurasi proyek
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = BASE_DIR / "output"
DEFAULT_TRAIN_PATH = BASE_DIR / "Training_BOP.csv"

TARGET_COLUMN = "went_on_backorder"
ID_COLUMN = "sku"
RANDOM_STATE = 42

NUMERIC_FEATURES = [
    "national_inv",
    "lead_time",
    "in_transit_qty",
    "forecast_3_month",
    "forecast_6_month",
    "forecast_9_month",
    "sales_1_month",
    "sales_3_month",
    "sales_6_month",
    "sales_9_month",
    "min_bank",
    "pieces_past_due",
    "perf_6_month_avg",
    "perf_12_month_avg",
    "local_bo_qty",
]

BINARY_FEATURES = [
    "potential_issue",
    "deck_risk",
    "oe_constraint",
    "ppap_risk",
    "stop_auto_buy",
    "rev_stop",
]

FEATURES = NUMERIC_FEATURES + BINARY_FEATURES

SENTINEL_VALUES = {
    "perf_6_month_avg": -99,
    "perf_12_month_avg": -99,
}

MODEL_FILENAME = "rf_model.pkl"
METADATA_FILENAME = "rf_model_metadata.json"
VALIDATION_FILENAME = "validation_data.csv.gz"
CV_RESULTS_FILENAME = "hyperparameter_search_results.csv"

LOGGER = logging.getLogger("backorder.train")


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def setup_logging(output_dir: Path, level: str = "INFO") -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path = output_dir / f"training_{datetime.now():%Y%m%d_%H%M%S}.log"

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    root.addHandler(stream)
    root.addHandler(file_handler)


def json_default(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Tipe tidak dapat diserialisasi: {type(value)!r}")


def resolve_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (BASE_DIR / path).resolve()


def read_table(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"File tidak ditemukan: {path}")

    suffix = path.suffix.lower()
    LOGGER.info("Membaca data: %s", path)
    if suffix in {".xlsx", ".xls", ".xlsm"}:
        df = pd.read_excel(path)
    else:
        df = pd.read_csv(path, low_memory=False)

    LOGGER.info("Data dimuat: %s baris x %s kolom", f"{len(df):,}", len(df.columns))
    return df


def normalize_target(series: pd.Series) -> pd.Series:
    """Ubah target Yes/No, true/false, atau 1/0 menjadi integer nullable."""
    result = pd.Series(pd.NA, index=series.index, dtype="Int64")

    numeric = pd.to_numeric(series, errors="coerce")
    result.loc[numeric.eq(0)] = 0
    result.loc[numeric.eq(1)] = 1

    text = series.astype("string").str.strip().str.lower()
    positive = text.isin({"yes", "y", "true", "backorder", "1"})
    negative = text.isin({"no", "n", "false", "aman", "0"})
    result.loc[positive] = 1
    result.loc[negative] = 0
    return result


def normalize_binary_series(series: pd.Series, column: str) -> pd.Series:
    """Normalisasi fitur biner ke string kanonik 'Yes'/'No'; missing tetap missing."""
    output = pd.Series(pd.NA, index=series.index, dtype="string")

    numeric = pd.to_numeric(series, errors="coerce")
    output.loc[numeric.eq(0)] = "No"
    output.loc[numeric.eq(1)] = "Yes"

    text = series.astype("string").str.strip().str.lower()
    yes_mask = text.isin({"yes", "y", "true", "1"})
    no_mask = text.isin({"no", "n", "false", "0"})
    output.loc[yes_mask] = "Yes"
    output.loc[no_mask] = "No"

    original_non_missing = series.notna() & series.astype("string").str.strip().ne("")
    invalid = original_non_missing & output.isna()
    if invalid.any():
        examples = series.loc[invalid].astype(str).value_counts().head(5).to_dict()
        raise ValueError(
            f"Kolom '{column}' memiliki nilai biner tidak valid. "
            f"Gunakan Yes/No atau 1/0. Contoh: {examples}"
        )

    return output


def prepare_dataset(
    df: pd.DataFrame,
    *,
    drop_exact_duplicates: bool = False,
) -> tuple[pd.DataFrame, pd.Series, dict[str, Any]]:
    required = set(FEATURES + [TARGET_COLUMN])
    missing = sorted(required - set(df.columns))
    if missing:
        raise ValueError(f"Kolom wajib tidak ditemukan: {missing}")

    working_columns = ([ID_COLUMN] if ID_COLUMN in df.columns else []) + FEATURES + [TARGET_COLUMN]
    data = df.loc[:, working_columns].copy()

    stats: dict[str, Any] = {
        "rows_loaded": int(len(data)),
        "exact_duplicates_detected": int(data.duplicated().sum()),
    }

    if drop_exact_duplicates:
        before = len(data)
        data = data.drop_duplicates().reset_index(drop=True)
        stats["exact_duplicates_dropped"] = int(before - len(data))
    else:
        stats["exact_duplicates_dropped"] = 0

    y = normalize_target(data[TARGET_COLUMN])
    invalid_target = y.isna()
    stats["invalid_target_rows_dropped"] = int(invalid_target.sum())
    if invalid_target.any():
        LOGGER.warning(
            "%s baris dengan target kosong/tidak valid dibuang.",
            f"{int(invalid_target.sum()):,}",
        )
        data = data.loc[~invalid_target].reset_index(drop=True)
        y = y.loc[~invalid_target].reset_index(drop=True)

    X = data.loc[:, FEATURES].copy()

    for column in NUMERIC_FEATURES:
        raw = X[column]
        cleaned = raw.replace(r"^\s*$", np.nan, regex=True)
        converted = pd.to_numeric(cleaned, errors="coerce")
        invalid_numeric = cleaned.notna() & converted.isna()
        if invalid_numeric.any():
            examples = raw.loc[invalid_numeric].astype(str).value_counts().head(5).to_dict()
            raise ValueError(
                f"Kolom numerik '{column}' memiliki nilai tidak valid. Contoh: {examples}"
            )
        X[column] = converted.astype("float64")

    sentinel_stats: dict[str, int] = {}
    for column, sentinel in SENTINEL_VALUES.items():
        count = int(X[column].eq(sentinel).sum())
        sentinel_stats[column] = count
        if count:
            X.loc[X[column].eq(sentinel), column] = np.nan
    stats["sentinel_replaced"] = sentinel_stats

    for column in BINARY_FEATURES:
        X[column] = normalize_binary_series(X[column], column)

    y = y.astype("int8")
    class_counts = y.value_counts().sort_index().to_dict()
    stats["rows_ready"] = int(len(X))
    stats["class_distribution"] = {
        "0": int(class_counts.get(0, 0)),
        "1": int(class_counts.get(1, 0)),
    }
    stats["positive_rate"] = float(y.mean())

    if y.nunique() != 2:
        raise ValueError(
            "Target harus memiliki dua kelas setelah pembersihan. "
            f"Distribusi saat ini: {stats['class_distribution']}"
        )

    return X, y, stats


def make_one_hot_encoder() -> OneHotEncoder:
    # sparse_output tersedia pada sklearn modern; fallback menjaga kompatibilitas.
    try:
        return OneHotEncoder(
            handle_unknown="ignore",
            drop="if_binary",
            sparse_output=False,
            dtype=np.float32,
        )
    except TypeError:  # sklearn lama
        return OneHotEncoder(
            handle_unknown="ignore",
            drop="if_binary",
            sparse=False,
            dtype=np.float32,
        )


def build_pipeline(random_state: int, n_jobs: int) -> Pipeline:
    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ]
    )
    binary_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", make_one_hot_encoder()),
        ]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            ("numeric", numeric_pipeline, NUMERIC_FEATURES),
            ("binary", binary_pipeline, BINARY_FEATURES),
        ],
        remainder="drop",
        sparse_threshold=0.0,
        verbose_feature_names_out=False,
    )

    classifier = RandomForestClassifier(
        n_estimators=400,
        max_depth=24,
        min_samples_split=5,
        min_samples_leaf=2,
        max_features="sqrt",
        class_weight=None,
        bootstrap=True,
        max_samples=0.8,
        random_state=random_state,
        n_jobs=n_jobs,
        verbose=0,
    )

    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("classifier", classifier),
        ]
    )


def make_search_sample(
    X: pd.DataFrame,
    y: pd.Series,
    sample_size: int,
    random_state: int,
) -> tuple[pd.DataFrame, pd.Series]:
    if sample_size <= 0 or len(X) <= sample_size:
        return X, y

    X_sample, _, y_sample, _ = train_test_split(
        X,
        y,
        train_size=sample_size,
        stratify=y,
        random_state=random_state,
    )
    return X_sample, y_sample


def tune_hyperparameters(
    X: pd.DataFrame,
    y: pd.Series,
    *,
    n_iter: int,
    cv_splits: int,
    search_sample_size: int,
    random_state: int,
    n_jobs: int,
    output_dir: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    X_search, y_search = make_search_sample(X, y, search_sample_size, random_state)
    LOGGER.info(
        "Hyperparameter search: %s baris, %s fold, %s kandidat.",
        f"{len(X_search):,}",
        cv_splits,
        n_iter,
    )

    search_pipeline = build_pipeline(random_state=random_state, n_jobs=1)
    parameter_distributions = {
        "classifier__n_estimators": [250, 400, 600],
        "classifier__max_depth": [16, 24, 32, None],
        "classifier__min_samples_split": [2, 5, 10, 20],
        "classifier__min_samples_leaf": [1, 2, 5, 10],
        "classifier__max_features": ["sqrt", 0.5, 0.8],
        "classifier__class_weight": [
            None,
            "balanced_subsample",
            {0: 1, 1: 5},
            {0: 1, 1: 10},
            {0: 1, 1: 20},
        ],
        "classifier__max_samples": [0.65, 0.8, 1.0],
    }

    cv = StratifiedKFold(
        n_splits=cv_splits,
        shuffle=True,
        random_state=random_state,
    )

    scoring = {
        "average_precision": "average_precision",
        "roc_auc": "roc_auc",
        "f1": "f1",
        "recall": "recall",
        "precision": "precision",
    }

    search = RandomizedSearchCV(
        estimator=search_pipeline,
        param_distributions=parameter_distributions,
        n_iter=n_iter,
        scoring=scoring,
        refit="average_precision",
        cv=cv,
        n_jobs=n_jobs,
        random_state=random_state,
        verbose=2,
        return_train_score=False,
        error_score="raise",
        pre_dispatch="2*n_jobs",
    )
    search.fit(X_search, y_search)

    cv_results = pd.DataFrame(search.cv_results_).sort_values(
        "rank_test_average_precision"
    )
    cv_path = output_dir / CV_RESULTS_FILENAME
    cv_results.to_csv(cv_path, index=False)

    best_params = dict(search.best_params_)
    summary = {
        "enabled": True,
        "sample_rows": int(len(X_search)),
        "cv_splits": int(cv_splits),
        "n_iter": int(n_iter),
        "scoring_refit": "average_precision",
        "best_cv_average_precision": float(search.best_score_),
        "best_params": best_params,
        "results_file": str(cv_path),
    }

    LOGGER.info("Best CV Average Precision: %.6f", search.best_score_)
    LOGGER.info("Best parameters: %s", best_params)
    return best_params, summary


def positive_probability(model: Pipeline, X: pd.DataFrame) -> np.ndarray:
    classifier = model.named_steps["classifier"]
    classes = list(classifier.classes_)
    if 1 not in classes:
        raise RuntimeError(f"Kelas positif 1 tidak ditemukan pada model: {classes}")
    positive_index = classes.index(1)
    return model.predict_proba(X)[:, positive_index]


def evaluate_validation(model: Pipeline, X: pd.DataFrame, y: pd.Series) -> dict[str, Any]:
    probability = positive_probability(model, X)
    prediction = (probability >= 0.5).astype(np.int8)

    cm = confusion_matrix(y, prediction, labels=[0, 1])
    tn, fp, fn, tp = (int(v) for v in cm.ravel())

    metrics = {
        "threshold": 0.5,
        "average_precision": float(average_precision_score(y, probability)),
        "roc_auc": float(roc_auc_score(y, probability)),
        "accuracy": float(accuracy_score(y, prediction)),
        "precision": float(precision_score(y, prediction, zero_division=0)),
        "recall": float(recall_score(y, prediction, zero_division=0)),
        "f1": float(f1_score(y, prediction, zero_division=0)),
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
    }

    LOGGER.info("Validation Average Precision : %.6f", metrics["average_precision"])
    LOGGER.info("Validation ROC-AUC           : %.6f", metrics["roc_auc"])
    LOGGER.info("Validation F1 @ 0.50         : %.6f", metrics["f1"])
    LOGGER.info("Validation Recall @ 0.50     : %.6f", metrics["recall"])
    LOGGER.info("Validation Precision @ 0.50  : %.6f", metrics["precision"])

    report = classification_report(
        y,
        prediction,
        labels=[0, 1],
        target_names=["Aman (0)", "Backorder (1)"],
        zero_division=0,
    )
    for line in report.strip().splitlines():
        LOGGER.info("  %s", line)

    return metrics


def save_validation_artifact(
    X_validation: pd.DataFrame,
    y_validation: pd.Series,
    output_dir: Path,
) -> Path:
    validation = X_validation.copy()
    validation[TARGET_COLUMN] = y_validation.to_numpy(dtype=np.int8)
    path = output_dir / VALIDATION_FILENAME
    validation.to_csv(path, index=False, compression="gzip")
    LOGGER.info("Validation artifact disimpan: %s", path)
    return path


def build_metadata(
    *,
    args: argparse.Namespace,
    train_path: Path,
    output_dir: Path,
    data_stats: dict[str, Any],
    fit_rows: int,
    validation_rows: int,
    fit_distribution: dict[int, int],
    validation_distribution: dict[int, int],
    best_params: dict[str, Any],
    search_summary: dict[str, Any],
    validation_metrics: dict[str, Any],
    validation_path: Path,
) -> dict[str, Any]:
    return {
        "schema_version": 2,
        "trained_at": utc_now_iso(),
        "model_type": "sklearn.pipeline.Pipeline(RandomForestClassifier)",
        "model_file": str(output_dir / MODEL_FILENAME),
        "training_file": str(train_path),
        "target_column": TARGET_COLUMN,
        "id_column": ID_COLUMN,
        "feature_names": FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "binary_features": BINARY_FEATURES,
        "sentinel_values": SENTINEL_VALUES,
        "random_state": int(args.random_state),
        "validation_size": float(args.validation_size),
        "data_statistics": data_stats,
        "fit_rows": int(fit_rows),
        "validation_rows": int(validation_rows),
        "fit_class_distribution": {str(k): int(v) for k, v in fit_distribution.items()},
        "validation_class_distribution": {
            str(k): int(v) for k, v in validation_distribution.items()
        },
        "model_parameters": best_params,
        "hyperparameter_search": search_summary,
        "validation_metrics_before_threshold_tuning": validation_metrics,
        "validation_artifact": str(validation_path),
        "optimal_threshold": 0.5,
        "threshold_status": "not_tuned",
        "library_versions": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
        "runtime": {
            "platform": platform.platform(),
            "cpu_count": os.cpu_count(),
        },
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(args: argparse.Namespace) -> None:
    output_dir = resolve_path(args.output_dir)
    train_path = resolve_path(args.train)
    setup_logging(output_dir, args.log_level)

    if not 0 < args.validation_size < 0.5:
        raise ValueError("--validation-size harus berada antara 0 dan 0.5.")
    if args.cv < 2:
        raise ValueError("--cv minimal 2.")
    if args.n_iter < 1:
        raise ValueError("--n-iter minimal 1.")

    start = datetime.now(timezone.utc)
    LOGGER.info("=" * 72)
    LOGGER.info("TRAINING RANDOM FOREST — BACKORDER PREDICTION")
    LOGGER.info("=" * 72)

    raw = read_table(train_path)
    X, y, data_stats = prepare_dataset(
        raw,
        drop_exact_duplicates=args.drop_exact_duplicates,
    )
    del raw

    LOGGER.info(
        "Distribusi target: Aman=%s | Backorder=%s | positive rate=%.4f%%",
        f"{int((y == 0).sum()):,}",
        f"{int((y == 1).sum()):,}",
        100 * float(y.mean()),
    )

    X_fit, X_validation, y_fit, y_validation = train_test_split(
        X,
        y,
        test_size=args.validation_size,
        stratify=y,
        random_state=args.random_state,
    )
    del X, y

    LOGGER.info(
        "Split: fit=%s baris | validation=%s baris",
        f"{len(X_fit):,}",
        f"{len(X_validation):,}",
    )

    validation_path = save_validation_artifact(X_validation, y_validation, output_dir)

    if args.no_tune:
        pipeline = build_pipeline(random_state=args.random_state, n_jobs=args.n_jobs)
        best_params = pipeline.get_params(deep=True)
        best_params = {
            key: value
            for key, value in best_params.items()
            if key.startswith("classifier__")
        }
        search_summary = {
            "enabled": False,
            "reason": "--no-tune digunakan",
        }
    else:
        best_params, search_summary = tune_hyperparameters(
            X_fit,
            y_fit,
            n_iter=args.n_iter,
            cv_splits=args.cv,
            search_sample_size=args.search_sample_size,
            random_state=args.random_state,
            n_jobs=args.n_jobs,
            output_dir=output_dir,
        )
        pipeline = build_pipeline(random_state=args.random_state, n_jobs=args.n_jobs)
        pipeline.set_params(**best_params)
        pipeline.set_params(classifier__n_jobs=args.n_jobs)

    LOGGER.info("Melatih model final pada seluruh fit split...")
    pipeline.fit(X_fit, y_fit)
    LOGGER.info("Training final selesai.")

    validation_metrics = evaluate_validation(pipeline, X_validation, y_validation)

    model_path = output_dir / MODEL_FILENAME
    joblib.dump(pipeline, model_path, compress=3)
    LOGGER.info("Pipeline model disimpan: %s", model_path)

    classifier_params = pipeline.named_steps["classifier"].get_params(deep=False)
    metadata = build_metadata(
        args=args,
        train_path=train_path,
        output_dir=output_dir,
        data_stats=data_stats,
        fit_rows=len(X_fit),
        validation_rows=len(X_validation),
        fit_distribution=y_fit.value_counts().sort_index().to_dict(),
        validation_distribution=y_validation.value_counts().sort_index().to_dict(),
        best_params=classifier_params,
        search_summary=search_summary,
        validation_metrics=validation_metrics,
        validation_path=validation_path,
    )

    metadata_path = output_dir / METADATA_FILENAME
    with metadata_path.open("w", encoding="utf-8") as file:
        json.dump(metadata, file, indent=2, ensure_ascii=False, default=json_default)
    LOGGER.info("Metadata disimpan: %s", metadata_path)

    elapsed = (datetime.now(timezone.utc) - start).total_seconds()
    LOGGER.info("Total waktu: %.1f detik", elapsed)
    LOGGER.info("Langkah berikutnya: python threshold_tuning.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Training Random Forest untuk prediksi backorder."
    )
    parser.add_argument(
        "--train",
        default=str(DEFAULT_TRAIN_PATH),
        help="Path Training_BOP.csv atau Excel.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help="Direktori output model, metadata, validation, dan log.",
    )
    parser.add_argument(
        "--validation-size",
        type=float,
        default=0.10,
        help="Proporsi validation set dari file training (default 0.10).",
    )
    parser.add_argument(
        "--no-tune",
        action="store_true",
        help="Lewati RandomizedSearchCV dan gunakan parameter default yang konservatif.",
    )
    parser.add_argument(
        "--n-iter",
        type=int,
        default=20,
        help="Jumlah kandidat RandomizedSearchCV (default 20).",
    )
    parser.add_argument(
        "--cv",
        type=int,
        default=3,
        help="Jumlah StratifiedKFold untuk tuning (default 3).",
    )
    parser.add_argument(
        "--search-sample-size",
        type=int,
        default=300_000,
        help="Maksimum baris untuk hyperparameter search; final fit tetap memakai seluruh fit split.",
    )
    parser.add_argument(
        "--n-jobs",
        type=int,
        default=-1,
        help="Jumlah core paralel. -1 memakai seluruh core.",
    )
    parser.add_argument(
        "--random-state",
        type=int,
        default=RANDOM_STATE,
    )
    parser.add_argument(
        "--drop-exact-duplicates",
        action="store_true",
        help="Hapus hanya baris yang identik pada seluruh kolom terpilih.",
    )
    parser.add_argument(
        "--log-level",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        default="INFO",
    )
    main(parser.parse_args())
