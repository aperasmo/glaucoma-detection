# backend/app/db/database.py
#
# This file sets up the async database connection for the entire app.
# It creates three things:
# 1. The async engine - the actual connection to PostgreSQL
# 2. The async session factory - used to create database sessions per request
# 3. The Base class - all models inherit from this so SQLAlchemy knows about them
#
# We use async (non-blocking) database access so FastAPI can handle
# multiple requests at the same time without waiting for the database.

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings
from app.core.logger import get_logger

from sqlalchemy.exc import SQLAlchemyError

logger = get_logger(__name__)

# --- Async Engine ---
# The engine manages the connection pool to PostgreSQL.
# echo=True logs all SQL statements to the console - useful for debugging.
# Set echo=False in production to avoid log noise.
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,  # Log SQL queries only when DEBUG=True
    pool_pre_ping=True,   # Test connections before using them - prevents stale connection errors
)

# --- Async Session Factory ---
# AsyncSessionLocal is a factory that creates new database sessions.
# Each request gets its own session, used for the duration of that request.
# expire_on_commit=False means we can still access model attributes after commit.
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# --- Base Class ---
# All database models inherit from this Base.
# SQLAlchemy uses this to track which classes are database tables.
class Base(DeclarativeBase):
    pass

# --- Dependency: get_db ---
# This is a FastAPI dependency function.
# It creates a database session for each incoming request,
# yields it to the route handler, then closes it automatically when done.
# Usage in routes: db: AsyncSession = Depends(get_db)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session           # Provide the session to the route handler
            await session.commit()  # Commit any changes after the handler is done
        except SQLAlchemyError as e:
            await session.rollback()
            logger.error(f"Database error - transaction rolled back: {str(e)}", exc_info=True)
            raise
        except Exception:
            await session.rollback()
            raise              # Re-raise the exception to be handled by FastAPI's error handlers
        finally:
            await session.close()     #Always close the session to free up resources