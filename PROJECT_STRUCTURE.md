# GlaucomaAI - Project Structure

## Overview

AI-powered glaucoma detection clinical system built with FastAPI backend,
React frontend, PostgreSQL database, and three deep learning models
(EfficientNetB0, VGG16, EfficientNetV2) with ensemble prediction.

---

## Root Directory

```
glaucoma-detection/
├── backend/                    # FastAPI backend application
├── frontend/                   # React frontend application
├── ml/                         # ML training pipeline and model files
├── docs/                       # Project documentation
├── notebooks/                  # Jupyter notebooks for exploration
├── .qodo/                      # Qodo AI config
├── docker-compose.yml          # Multi-container Docker setup
├── .env.example                # Environment variables template
└── README.md                   # Project overview
```

---

## Backend Structure

```
backend/
├── main.py                     # FastAPI app entry point, CORS, routers
├── config.py                   # Settings - DB URL, model paths, JWT secret, env vars
├── requirements.txt            # Python dependencies
├── Dockerfile                  # Backend Docker image
│
├── database/                   # Database connection and session management
│   ├── __init__.py
│   ├── connection.py           # SQLAlchemy engine, SessionLocal, Base
│   └── init_db.py              # Database initialisation and table creation
│
├── models/                     # SQLAlchemy ORM database models
│   ├── __init__.py
│   ├── user.py                 # User model - id, email, password_hash, role, clinic
│   ├── patient.py              # Patient model - id, name, dob, gender, medical history
│   └── screening.py            # Screening model - results, heatmap path, referral letter
│
├── schemas/                    # Pydantic request and response schemas
│   ├── __init__.py
│   ├── user.py                 # UserCreate, UserLogin, UserResponse, Token
│   ├── patient.py              # PatientCreate, PatientUpdate, PatientResponse
│   └── screening.py            # ScreeningCreate, ScreeningResponse, ScreeningResult
│
├── routers/                    # API route handlers
│   ├── __init__.py
│   ├── auth.py                 # POST /auth/login, /auth/register, /auth/refresh
│   ├── patients.py             # CRUD /patients, /patients/{id}, /patients/{id}/history
│   ├── screening.py            # POST /screening/run, GET /screening/{id}
│   │                           # GET /screening/{id}/heatmap, /screening/{id}/report
│   ├── analytics.py            # GET /analytics/summary, /analytics/model-performance
│   └── reports.py              # GET /reports/export
│
├── services/                   # Business logic and external integrations
│   ├── __init__.py
│   ├── ml_service.py           # Load models, run inference, ensemble prediction
│   │                           # Returns: probability, prediction, threshold, model used
│   ├── gradcam_service.py      # Grad-CAM++ heatmap generation for all 3 models
│   │                           # Ensemble heatmap (average of all 3)
│   ├── llm_service.py          # GPT-4o referral letter generation
│   │                           # Multi-LLM comparison: GPT-4o, GPT-4o-mini, LLaMA, Gemini
│   └── email_service.py        # High risk alert email notifications via APScheduler
│
└── utils/                      # Shared utilities
    ├── __init__.py
    ├── security.py             # JWT token creation, verification, password hashing
    └── preprocessing.py        # CLAHE enhancement, backbone-specific preprocess_input
```

---

## Frontend Structure

```
frontend/
├── public/
│   └── index.html
├── src/
│   ├── main.jsx                # React entry point
│   ├── App.jsx                 # Router setup, protected routes
│   ├── index.css               # Global styles
│   │
│   ├── components/             # Reusable UI components
│   │   ├── Sidebar.jsx
│   │   ├── Header.jsx
│   │   ├── ProtectedRoute.jsx
│   │   └── HeatmapViewer.jsx
│   │
│   ├── pages/                  # 15 application pages
│   │   ├── Login.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Patients.jsx
│   │   ├── PatientDetail.jsx
│   │   ├── PatientAdd.jsx
│   │   ├── RunScreening.jsx
│   │   ├── ScreeningResult.jsx
│   │   ├── ScreeningHistory.jsx
│   │   ├── Reports.jsx
│   │   ├── Analytics.jsx
│   │   ├── ModelPerformance.jsx
│   │   ├── ReferralLetter.jsx
│   │   ├── Settings.jsx
│   │   ├── UserManagement.jsx
│   │   └── Help.jsx
│   │
│   ├── api/                    # Axios API calls to backend
│   │   ├── auth.js
│   │   ├── patients.js
│   │   ├── screening.js
│   │   └── analytics.js
│   │
│   └── context/                # React context for global state
│       └── AuthContext.jsx
│
├── package.json
├── vite.config.js
└── Dockerfile
```

---

## ML Pipeline Structure

```
ml/
├── config.py                   # Portable path resolution using os.path.abspath
│
├── datasets/                   # CSV files for dataset management
│   ├── master_labels.csv       # 4,148 images - all labels unified
│   ├── train.csv               # 3,110 images (75%)
│   ├── val.csv                 # 623 images (15%)
│   └── test.csv                # 415 images (10%)
│
├── training/                   # Training scripts
│   ├── build_master_labels.py  # Builds master_labels.csv from 6 datasets
│   ├── preprocessing.py        # CLAHE + backbone preprocess_input + splits
│   ├── train_model.py          # Phase 1 training - top 20 layers unfrozen
│   ├── train_model_phase2.py   # Phase 2 training - full backbone fine-tuning
│   ├── evaluate_models.py      # Test set evaluation, Youden's J, sensitivity-first
│   ├── mcnemar_test.py         # McNemar's statistical test - pairwise comparison
│   └── gradcam.py              # Grad-CAM++ heatmap generation for all 3 models
│
├── models/                     # Saved model checkpoints (.h5)
│   ├── efficientnetb0/
│   │   └── efficientnetb0_phase2b_best.h5   # AUC 0.9108
│   ├── vgg16/
│   │   └── vgg16_phase2b_best.h5            # AUC 0.9198
│   └── efficientnetv2/
│       └── efficientnetv2_phase2b_best.h5   # AUC 0.9091
│
├── metrics/                    # Evaluation results
│   ├── evaluation_results.json # Full metrics per model and ensemble
│   └── mcnemar_results.json    # Statistical comparison results
│
├── outputs/                    # Generated outputs
│   └── gradcam/                # Grad-CAM++ heatmap images
│       ├── efficientnetb0/
│       │   ├── tp_samples/
│       │   ├── fn_samples/
│       │   ├── tn_samples/
│       │   ├── fp_samples/
│       │   └── summary_grid.png
│       ├── vgg16/
│       │   └── (same structure)
│       ├── efficientnetv2/
│       │   └── (same structure)
│       └── ensemble/
│           └── ensemble_summary.png
│
├── logs/                       # Training logs CSV per model per phase
└── utils/
    ├── check_layers.py         # Model layer inspection debug tool
    └── debug_gradcam.py        # Grad-CAM gradient debug tool
```

---

## Dataset Sources

```
Raw datasets (not in repo - stored locally):
├── ORIGA/          650 images  | Label: glaucoma.csv
├── ACRIMA/         705 images  | Label: _g_ in filename
├── PAPILA/         488 images  | Label: patient_data_od/os.xlsx
├── REFUGE/         800 images  | Label: folder name (train+val)
├── RIM-ONE-DL/     485 images  | Label: folder name (partitioned)
└── G1020/         1020 images  | Label: G1020.csv

Total: 4,148 images
Glaucoma: 1,227 (29.6%) | Normal: 2,921 (70.4%) | Ratio: 1:2.4
```

---

## Model Performance Summary

| Model | AUC | Sensitivity | Specificity | F1 |
|---|---|---|---|---|
| EfficientNetB0 | 0.9108 | 85.4% | 76.4% | 0.707 |
| VGG16 | 0.9198 | 85.4% | 79.1% | 0.727 |
| EfficientNetV2 | 0.9091 | 85.4% | 74.3% | 0.693 |
| **Ensemble** | **0.9270** | **85.4%** | **79.8%** | **0.732** |

Evaluated on 415 unseen test images at sensitivity-first threshold.
McNemar's test confirmed all differences statistically significant (p<0.05).

---

## Tech Stack

```
Backend:
- FastAPI          - REST API framework
- SQLAlchemy       - ORM for database models
- PostgreSQL       - Production database
- Alembic          - Database migrations
- JWT              - Authentication tokens
- APScheduler      - Scheduled tasks (high risk email alerts)
- TensorFlow 2.x   - Model inference
- OpenCV           - Image preprocessing (CLAHE)
- tf-keras-vis     - Grad-CAM++ for VGG16

Frontend:
- React 18         - UI framework
- Vite             - Build tool
- React Router 6   - Client-side routing
- Axios            - HTTP client
- TailwindCSS      - Styling

Infrastructure:
- Docker           - Containerisation
- Docker Compose   - Multi-container orchestration
- AWS EC2          - Backend hosting
- AWS S3           - Image storage
- GitHub Actions   - CI/CD pipeline

LLM Integration:
- GPT-4o Vision    - Primary referral letter generation
- GPT-4o-mini      - Alternative LLM
- LLaMA Vision     - Open source alternative
- Gemini Vision    - Google alternative
```

---

## API Endpoints Summary

```
AUTH
POST   /auth/register
POST   /auth/login
POST   /auth/refresh

PATIENTS
GET    /patients
POST   /patients
GET    /patients/{id}
PUT    /patients/{id}
DELETE /patients/{id}
GET    /patients/{id}/history

SCREENING
POST   /screening/run
GET    /screening/{id}
GET    /screening/{id}/heatmap
GET    /screening/{id}/report

ANALYTICS
GET    /analytics/summary
GET    /analytics/model-performance

REPORTS
GET    /reports/export
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/glaucoma_db

# JWT
JWT_SECRET_KEY=your-secret-key
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=30

# Model paths
MODEL_DIR=./ml/models
EFFICIENTNETB0_PATH=./ml/models/efficientnetb0/efficientnetb0_phase2b_best.h5
VGG16_PATH=./ml/models/vgg16/vgg16_phase2b_best.h5
EFFICIENTNETV2_PATH=./ml/models/efficientnetv2/efficientnetv2_phase2b_best.h5

# OpenAI
OPENAI_API_KEY=your-openai-key
GPT_MODEL=gpt-4o

# Email alerts
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alerts@clinic.com
SMTP_PASSWORD=your-app-password
HIGH_RISK_THRESHOLD=0.80

# AWS
AWS_BUCKET_NAME=glaucoma-screening-images
AWS_REGION=ap-southeast-2
```

---

*MSE907 Capstone - AI Glaucoma Detection Clinical System*
*Student: Allan Pascual Erasmo | Supervisor: Mohammad Norouzifard*
*Yoobee College Auckland | August 2026*
