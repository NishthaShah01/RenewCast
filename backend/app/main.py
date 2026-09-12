"""RenewCast API — application entrypoint.

Run locally from the backend/ directory:

    uvicorn app.main:app --reload --port 8000

Everything is mounted under /api so the frontend can proxy a single prefix.
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

# Ensure backend root is on sys.path when executed directly
_backend_dir = Path(__file__).resolve().parent.parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routers import (
    accuracy,
    copilot,
    decisions,
    forecast,
    health,
    simulator,
    sites,
)
from app.schemas import ErrorResponse
from app.store import init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
)
log = logging.getLogger("renewcast")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Boot work: create the schema and report what the server can do.

    Deliberately tolerant. A missing model directory is logged and the server
    starts anyway in physics-only mode, because a demo that refuses to boot is
    worse than one that boots honestly degraded — and /health says which.
    """
    init_db()
    settings.cache_path.mkdir(parents=True, exist_ok=True)

    models = sorted(settings.model_path.glob("*.joblib")) if settings.model_path.exists() else []
    log.info("%s v%s", settings.app_name, settings.version)
    # ASCII only in log lines: the Windows console codepage renders an em dash
    # as a replacement character, and a demo that prints mojibake on boot
    # undercuts everything after it.
    log.info("models      : %s", f"{len(models)} loaded" if models else "none - physics only")
    log.info("copilot     : %s", settings.copilot_mode)
    log.info("cors origins: %s", ", ".join(settings.origins))

    yield

    log.info("shutdown")


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Probabilistic 72-hour generation forecasting for Indian solar and "
        "wind sites, aligned to the 96-block despatch day."
    ),
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    # Vercel names every preview deployment after the commit that produced it,
    # so the origin a reviewer opens cannot be known when this is configured.
    # Matching the pattern keeps previews working without loosening production,
    # which stays on the explicit list above.
    allow_origin_regex=r"https://renewcast-[a-z0-9-]+\.vercel\.app",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(KeyError)
async def _key_error_handler(request: Request, exc: KeyError) -> JSONResponse:
    """Unknown site ids surface as 404s with the message the lookup wrote.

    `get_site` raises KeyError carrying a sentence meant for a human, so it is
    passed through rather than replaced with 'Internal Server Error'.
    """
    return JSONResponse(
        status_code=404,
        content=ErrorResponse(
            error="not_found",
            detail=str(exc).strip("'\""),
            hint="Call GET /api/sites for the list of valid site ids.",
        ).model_dump(),
    )


app.include_router(health.router, prefix="/api")
app.include_router(sites.router, prefix="/api")
app.include_router(forecast.router, prefix="/api")
app.include_router(decisions.router, prefix="/api")
app.include_router(accuracy.router, prefix="/api")
app.include_router(copilot.router, prefix="/api")
app.include_router(simulator.router, prefix="/api")


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "version": settings.version,
        "docs": "/api/docs",
        "health": "/api/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)

