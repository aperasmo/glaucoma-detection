# backend/app/core/config.py
#
# Central configuration for the GlaucomaAI backend.
# All environment-specific values (database URL, secret keys, etc.)
# are loaded from the .env file using pydantic-settings.
# This means we never hardcode sensitive values in the source code.
# Any setting here can be overridden by setting the matching key in .env.

from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """
    Settings class reads configuration from environment variables.
    Pydantic-settings automatically maps .env file keys to these fields.
    If a key is missing in .env, the default value here is used instead.
    """

    # --- App Identity ---
    # Basic information about this API service
    APP_NAME: str = "GlaucomaAI API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True # Set to True for development, False for production

    # --- Security ---
    # SECRET_KEY is used to sign JWT tokens - must be a long random string in production
    # ALGORITHM is the JWT signing algorithm - HS256 is the standard choice
    # ACCESS_TOKEN_EXPIRE_MINUTES controls how long a login session lasts
    SECRET_KEY: str = "change this to a secure random string in production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 # 1 day

    # --- Database ---
    # Full async PostgreSQL connection string
    # Format: postgresql+asyncpg://user:password@host:port/database_name
    # asyncpg is the async driver that works with SQLAlchemy async mode
    # Example: postgresql+asyncpg://postgres:password@localhost:5432/glaucoma_ai
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/glaucoma_db"

    # --- CORS ---
    # List of allowed frontend origins that can call this API
    # In development this is the Vite dev server (port 5173)
    # In production this will be the deployed frontend URL
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    model_config = {
        # Tell pydantic-settings to read from the .env file
        # The .env file should sit in the backend/ folder
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }

    # Create a single shared instance of Settings.
    # All other modules import this `settings` object directly.
    # Example: from app.core.config import settings        

    # --- EMAIL ACTIVATION ---
    # These settings are used for sending account activation emails.
    FRONTEND_URL: str = "http://localhost:5173"
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_SENDER: str = ""

    # --- LLM API KEYS ---
    OPENAI_API_KEY: str = ""
    GROQ_API_KEY: str = ""
    GEMINI_API_KEY: str = ""

    # --- Test images directory ---
    TEST_IMAGES_DIR: str = "test_images"
    TEST_IMAGES_DONE_DIR: str = "test_images/done"

    # --- Reports Services ---
    REPORT_SERVICE_BASE_URL: str = "http://localhost:8001"    
        # --- Report Assistant LLM ---    
    REPORT_ASSISTANT_LLM_ENABLED: bool = False
    REPORT_ASSISTANT_LLM_API_URL: str | None = None
    REPORT_ASSISTANT_LLM_API_KEY: str | None = None
    REPORT_ASSISTANT_LLM_MODEL: str | None = None
    REPORT_ASSISTANT_LLM_TIMEOUT_SECONDS: int = 20
settings = Settings()