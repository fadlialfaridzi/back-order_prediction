# MRP System — Backorder Prediction

Sistem prediksi backorder berbasis Machine Learning untuk manajemen inventaris pabrik. Menggunakan **Random Forest Classifier** yang dilatih pada dataset backorder produk untuk memprediksi risiko kehabisan stok.

---

## 📐 Arsitektur

```
┌─────────────────────┐    ┌──────────────────────┐    ┌────────────────────┐
│   Next.js Frontend  │    │  Express.js Backend   │    │  Flask ML Service  │
│   localhost:3000     │───▶│  localhost:5000        │───▶│  localhost:5001     │
│                     │    │                        │    │                    │
│  • Dashboard        │    │  • REST API proxy      │    │  • rf_model.pkl    │
│  • Prediksi Manual  │    │  • PostgreSQL queries   │    │  • /predict        │
│  • Batch CSV        │    │  • CSV upload handler   │    │  • /predict/batch  │
│  • Inventaris       │    │  • Run-all + upsert     │    │  • /model/info     │
│  • Analisis Model   │    │  • Health check         │    │  • /health         │
└─────────────────────┘    └──────────────────────┘    └────────────────────┘
                                      │
                                      ▼
                           ┌──────────────────────┐
                           │     PostgreSQL        │
                           │  db_inventaris_pabrik │
                           │                       │
                           │  • master_barang      │
                           │  • mutasi_inventaris   │
                           │  • log_prediksi       │
                           └──────────────────────┘
```

---

## ⚙️ Prasyarat

| Software     | Versi Minimum |
|-------------|--------------|
| **Node.js** | 18.x         |
| **Python**  | 3.10+        |
| **PostgreSQL** | 14+       |
| **npm**     | 9+           |

---

## 🚀 Instalasi & Setup

### 1. Clone Repository

```bash
git clone https://github.com/<username>/mrp.git
cd mrp
```

### 2. Setup Database

```bash
# Buat database
psql -U postgres -c "CREATE DATABASE db_inventaris_pabrik;"

# Jalankan migrasi
psql -U postgres -d db_inventaris_pabrik -f backend/migrations/001_create_tables.sql
```

### 3. Setup Model Service (Python/Flask)

```bash
cd model

# Buat virtual environment
python -m venv env
# Windows:
env\Scripts\activate
# Linux/Mac:
source env/bin/activate

# Install dependencies
pip install -r requirements.txt
```

> **Catatan**: File model `output/rf_model.pkl` (~550MB) harus sudah ada.
> Jika belum, latih model terlebih dahulu:
> ```bash
> python train.py --smote
> python threshold_tuning.py
> ```

### 4. Setup Backend (Express.js)

```bash
cd backend

# Install dependencies
npm install

# Buat file .env dari template
cp .env.example .env
# Edit .env dan sesuaikan DB_PASSWORD
```

### 5. Setup Frontend (Next.js)

```bash
cd frontend

# Install dependencies
npm install
```

---

## ▶️ Menjalankan Sistem

Jalankan **3 service** secara bersamaan (di 3 terminal terpisah):

```bash
# Terminal 1: Model Service (Flask)
cd model
python app.py
# → http://localhost:5001

# Terminal 2: Backend (Express.js)
cd backend
npm run dev
# → http://localhost:5000

# Terminal 3: Frontend (Next.js)
cd frontend
npm run dev
# → http://localhost:3000
```

Buka browser dan akses **http://localhost:3000**.

---

## 📂 Struktur Project

```
mrp/
├── backend/                  # Express.js API server
│   ├── migrations/           # SQL migration files
│   │   └── 001_create_tables.sql
│   ├── server.js             # Main server file
│   ├── .env.example          # Template environment variables
│   └── package.json
│
├── model/                    # Python ML pipeline
│   ├── app.py                # Flask inference service
│   ├── train.py              # Training pipeline
│   ├── predict.py            # CLI batch prediction
│   ├── threshold_tuning.py   # Threshold optimizer
│   ├── requirements.txt      # Python dependencies
│   ├── Training_BOP.csv      # Training dataset
│   ├── Testing_BOP.csv       # Testing dataset
│   └── output/               # Model artifacts
│       ├── rf_model.pkl          # Trained model (~550MB)
│       └── rf_model_metadata.json # Model metadata
│
├── frontend/                 # Next.js web interface
│   ├── app/
│   │   ├── page.tsx              # Dashboard
│   │   ├── predict/page.tsx      # Single item prediction
│   │   ├── batch/page.tsx        # CSV batch upload
│   │   ├── inventory/page.tsx    # Inventory management
│   │   ├── analysis/page.tsx     # Model analysis
│   │   ├── not-found.tsx         # Custom 404 page
│   │   ├── components/           # Reusable components
│   │   └── lib/api.ts            # API helpers & types
│   └── package.json
│
└── README.md
```

---

## 🧪 Fitur Model

- **Algoritma**: Random Forest Classifier (100 trees, balanced class weight)
- **SMOTE**: Synthetic Minority Over-sampling untuk menangani class imbalance
- **Threshold**: 15% (diturunkan dari 50% default untuk meningkatkan recall)
- **Fitur**: 21 parameter inventaris & supply chain
- **Dataset**: Backorder Product (BOP) dataset

### Metrik Evaluasi

| Metrik     | Nilai  |
|-----------|--------|
| Accuracy  | 98.79% |
| Precision | 31.32% |
| Recall    | 7.33%  |
| F1-Score  | 11.88% |
| ROC-AUC   | 85.51% |

---

## 📡 API Endpoints

### Backend (Express.js :5000)

| Method | Endpoint                  | Deskripsi                                |
|--------|--------------------------|------------------------------------------|
| GET    | `/api/barang`            | Data master barang + inventaris          |
| POST   | `/api/predict`           | Prediksi single item (21 fitur)          |
| POST   | `/api/predict/batch`     | Prediksi batch (JSON array)              |
| POST   | `/api/predict/upload-csv`| Upload CSV untuk batch prediction        |
| POST   | `/api/predict/run-all`   | Prediksi semua item + simpan ke DB       |
| GET    | `/api/predict/log`       | Hasil prediksi terakhir per SKU          |
| GET    | `/api/model/info`        | Metadata model (fitur, threshold, metrik)|
| GET    | `/api/health`            | Health check (backend + DB + ML service) |

### ML Service (Flask :5001)

| Method | Endpoint          | Deskripsi                    |
|--------|------------------|------------------------------|
| POST   | `/predict`       | Prediksi 1 item              |
| POST   | `/predict/batch` | Prediksi batch               |
| GET    | `/model/info`    | Metadata model               |
| GET    | `/health`        | Health check                 |

---

## 📄 Lisensi

ISC
