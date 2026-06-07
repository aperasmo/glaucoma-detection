# backend/app/core/logger.py
#
# Centralised logging configuration for the GlaucomaAI backend.
# Uses Python built-in logging module integrated with FastAPI/uvicorn.
# Two handlers - console and daily rotating file.
# Import logger from here in all backend modules.
# Never use print() in backend code - always use logger.

import logging
import os
from datetime import datetime
from logging.handlers import TimedRotatingFileHandler

# Create logs directory inside backend folder
LOG_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "logs")
os.makedirs(LOG_DIR, exist_ok=True)

# Daily log filename format: glaucoma_backend_YYYYMMDD.log 
today = datetime.now().strftime("%Y%m%d")
LOG_FILE = os.path.join(LOG_DIR, f"glaucoma_backend_{today}.log")

# Log format: timestamp | level | module | message
LOG_FORMAT = "%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s"
DATE_FORMAT = "%m/%d/%Y %I:%M:%S %p"

def setup_logger() -> logging.Logger:
    # Create and configure the main application logger.
    # Call this once during FastAPI startup.
    # Returns the configured logger instance.

    logger = logging.getLogger("glaucoma_backend")
    logger.setLevel(logging.INFO)

    # Avoid adding duplicate handlers on reload
    if logger.handlers:
        return logger

    formatter = logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT)

    # Console handler - outputs to terminal alongside uvicorn logs
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(formatter)

    # File handler - daily rotating log file
    file_handler = TimedRotatingFileHandler(
        LOG_FILE,
        when="midnight",
        interval=1,
        backupCount=30,  # Keep 30 days of logs
        encoding="utf-8",
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)

    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    return logger


# Module-level loggers - import these in each module
# Usage: from app.core.logger import get_logger
# Then: logger = get_logger(__name__)

def get_logger(name: str) -> logging.Logger:
    # Get a child logger for a specific module.
    # Child loggers inherit config from the parent glaucoma_backend logger.
    # Usage: logger = get_logger(__name__)
    return logging.getLogger(f"glaucoma_backend.{name}")
