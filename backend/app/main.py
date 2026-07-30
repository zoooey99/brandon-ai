"""
Brandon Backend - Main FastAPI Application
AI-powered fitness coaching via SMS integration with Mac iMessage relay server.
"""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
import logging
import sys
from contextlib import asynccontextmanager

from app.config import settings
from app.api.routes import messages, health, scheduling, plan, cron, phone
from app.admin import router as admin_router

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)

logger = logging.getLogger(__name__)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"

        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"

        # XSS protection (legacy, but still useful)
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Referrer policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # HSTS (only in production to avoid issues with local dev)
        if settings.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for startup and shutdown events."""
    # Startup
    logger.info("🚀 Brandon Backend starting...")
    logger.info(f"Environment: {settings.environment}")
    logger.info(f"Mac Server URL: {settings.mac_server_url}")
    logger.info(f"OpenAI Model: {settings.openai_model}")

    yield

    # Shutdown
    logger.info("👋 Brandon Backend shutting down...")


# Create FastAPI app
app = FastAPI(
    title="Brandon Backend",
    description="AI-powered fitness coaching backend with SMS integration",
    version="1.0.0",
    lifespan=lifespan
)

# Security headers middleware
app.add_middleware(SecurityHeadersMiddleware)

# CORS middleware (configure as needed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.environment == "development" else [
        "https://brandon-replit.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler for unhandled errors."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if settings.environment == "development" else "An error occurred"
        }
    )


# Include routers
app.include_router(health.router, tags=["Health"])
app.include_router(messages.router, prefix="/mac", tags=["Messages"])
app.include_router(scheduling.router, prefix="/api", tags=["Scheduling"])
app.include_router(plan.router, prefix="/api", tags=["Plan"])
app.include_router(cron.router, prefix="/cron", tags=["Cron"])
app.include_router(phone.router, prefix="/api/phone", tags=["Phone Verification"])
app.include_router(admin_router, tags=["Admin"])


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": "Brandon Backend",
        "version": "1.0.0",
        "status": "running",
        "environment": settings.environment,
        "docs": "/docs"
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=settings.environment == "development",
        reload_excludes=["venv/*", ".venv/*", "*.pyc", "__pycache__/*"],
        log_level=settings.log_level.lower()
    )
