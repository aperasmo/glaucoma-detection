# entry point for the GlaucomaAI FastAPI backend - builds the app, wires up
# middleware and pulls in all the route groups. this is what uvicorn points at.

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.logger import setup_logger, get_logger
from app.api.routes.auth import router as auth_router # registration, activation, login

from app.api.routes.patient import router as patient_router # patient CRUD
from app.api.routes.screening import router as screening_router # image upload + screening management

from contextlib import asynccontextmanager
from app.ml_inference.model_loader import load_all_models

from app.core.scheduler import start_scheduler, stop_scheduler # background jobs via APScheduler
from app.api.routes.screening_result import router as screening_result_router # ML inference results for the frontend
from app.api.routes.user import router as user_router # admin-only user CRUD

from fastapi.staticfiles import StaticFiles # serves uploaded images from /uploads (files live in uploads/ on disk)
from app.api.routes.settings import router as settings_router # admin-only system settings

from app.api.routes.admin import router as admin_router # admin monitoring/maintenance routes

from app.api.routes.reports import router as reports_router # PDF export endpoints

from app.api.routes.model_performance import router as model_performance_router # serves the frozen test-set eval metrics
from app.api.routes.llm_evaluation import router as evaluation_router # LLM evaluation routes
from app.api.routes.feedback import router as feedback_router


from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.core.limiter import limiter
logger = get_logger(__name__)



# title/version come from the settings object and show up in the /docs swagger page
@asynccontextmanager
async def lifespan(app: FastAPI):
    # get logging set up before anything else touches the app
    setup_logger()
    # load the ML models once at startup so they stay in memory for the whole process
    logger.info("Loading ML models... Please wait...")
    load_all_models()
    logger.info("ML models are now ready.")
    start_scheduler()
    yield
    # shutdown cleanup
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

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# serve uploaded images and Grad-CAM++ heatmaps as static files, e.g. http://localhost:8000/uploads/...
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# CORS - without this the browser blocks the React frontend from calling the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else settings.CORS_ORIGINS.split(","),     # allowed origins, from settings
    allow_credentials=True,                 # let cookies/auth headers cross origins
    allow_methods=["*"],                    # allow all HTTP methods
    allow_headers=["*"],                    # allow all headers
)

app.include_router(auth_router) # registration, activation, login
app.include_router(patient_router) # patient CRUD
app.include_router (screening_router) # image upload + screening management
app.include_router(screening_result_router) # ML inference results for the frontend
app.include_router(user_router) # admin-only user CRUD
app.include_router(settings_router) # admin-only system settings
app.include_router(admin_router) # admin monitoring/maintenance
app.include_router(reports_router) # PDF exports
app.include_router(model_performance_router) # frozen test-set eval metrics
app.include_router(evaluation_router) # LLM evaluation
app.include_router(feedback_router) # feedback form submissions -> ops inbox

# first route we register - just confirms the API is up, used by health checks later
@app.get("/health", tags = ["System"])
async def health_check():
    """Basic liveness check - returns app name, version, status."""
    return{
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "status": "ok"
    }