# backend/app/main.py
#
# This is the main entry point for the GlaucomaAI FastAPI backend.
# It creates the FastAPI app instance, registers middleware,
# and includes all route groups.
# Uvicorn points to this file when starting the server.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.logger import setup_logger, get_logger
from app.api.routes.auth import router as auth_router # Authentication routes - registration, activation, login

from app.api.routes.patient import router as patient_router # Patient management routes - CRUD operations
from app.api.routes.screening import router as screening_router # Screening routes - image upload and management

from contextlib import asynccontextmanager
from app.ml_inference.model_loader import load_all_models

from app.core.scheduler import start_scheduler, stop_scheduler # APScheduler for background tasks
from app.api.routes.screening_result import router as screening_result_router # Screening result routes - returns ML inference results to frontend
from app.api.routes.user import router as user_router # User management routes - admin-only user CRUD operations

from fastapi.staticfiles import StaticFiles # Serve uploaded images from the /uploads URL path. The actual files are stored in the uploads/ folder on disk.
from app.api.routes.settings import router as settings_router # System settings routes - admin-only settings management

# Module-level logger for main application events
logger = get_logger(__name__)

# --- Create the FastAPI app instance ---
# The title and version are pulled from central settings object.
# These appear in the auto-generated Swagger docs at /docs.
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialise centralised logging first - before any other startup step
    setup_logger()
    # Load all ML models into memory on server startup.
    # Models stay loaded for the lifetime of the server process.
    logger.info("Loading ML models...")
    load_all_models()
    logger.info("ML models ready.")
    start_scheduler()
    yield
    # Cleanup on shutdown if needed
    stop_scheduler()
    logger.info("Server shutting down.")

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="API backend for GlaucomaAI - a tool to assist in glaucoma diagnosis using AI.",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Serve uploaded images and Grad-CAM++ heatmaps as static files
# Frontend accesses images at http://localhost:8000/uploads/...
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# --- CORS Middleware ---
# CORS (Cross-Origin Resource Sharing) controls which frontend URLs
# are allowed to make requests to this API.
# Without this, the React frontend will be blocked by the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else settings.CORS_ORIGINS.split(","),     # List of allowed origins from settings
    allow_credentials=True,                 # Allow cookies and auth headers to be sent across origins
    allow_methods=["*"],                    # Allow all HTTP methods (GET, POST, etc.)
    allow_headers=["*"],                    # Allow all headers (Authorization, Content-Type, etc.)
)

app.include_router(auth_router) # Authentication routes - registration, activation, login
app.include_router(patient_router) # Patient management routes - CRUD operations
app.include_router (screening_router) # Screening routes - image upload and management
app.include_router(screening_result_router) # Screening result routes - returns ML inference results to frontend
app.include_router(user_router) # User management routes - admin-only user CRUD operations
app.include_router(settings_router) # System settings routes - admin-only settings management
# --- Health Check Endpoint ---
# This is the first route we register.
# It confirms the API is running and returns basic app info.
# Used by Docker health checks and monitoring tools later.
@app.get("/health", tags = ["System"])
async def health_check():
    """
    Health check endpoint.
    Returns app name, version, and status.
    Call this to confirm the API is alive.
    """    
    return{
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "ok"
    }