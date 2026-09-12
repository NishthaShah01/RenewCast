"""Application configuration.

Every tunable lives here and is overridable by environment variable, so the
same image runs locally and on Render without code changes.
"""

from __future__ import annotations

from datetime import timedelta, timezone
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The backend/ directory, regardless of where the process was launched from.
BACKEND_DIR = Path(__file__).resolve().parent.parent

# India observes no daylight saving, so IST is a fixed offset. Using a fixed
# offset rather than zoneinfo("Asia/Kolkata") deliberately avoids a runtime
# dependency on the `tzdata` package, which Windows does not ship.
IST = timezone(timedelta(hours=5, minutes=30), name="IST")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Identity ─────────────────────────────────────────────────────────
    app_name: str = "RenewCast API"
    version: str = "0.1.0"

    # ── AI Copilot (optional) ────────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"

    # ── CORS ─────────────────────────────────────────────────────────────
    allowed_origins: str = "http://localhost:3000,https://renewcast.vercel.app"

    # ── Forecasting ──────────────────────────────────────────────────────
    weather_cache_ttl_min: int = Field(default=30, ge=0)
    default_horizon_hours: int = Field(default=72, ge=1, le=72)
    max_horizon_hours: int = Field(default=72, ge=1, le=72)

    # ── Paths ────────────────────────────────────────────────────────────
    model_dir: str = "models"
    db_path: str = "data/renewcast.db"
    cache_dir: str = "data/cache"

    @field_validator("allowed_origins")
    @classmethod
    def _strip_origins(cls, v: str) -> str:
        return v.strip()

    # ── Derived ──────────────────────────────────────────────────────────
    @property
    def origins(self) -> list[str]:
        """CORS origins as a list, empty entries discarded."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def copilot_mode(self) -> str:
        """Which explainer is active.

        The UI surfaces this so a reader always knows whether narration came
        from a language model or the deterministic intent router. Either way
        the *numbers* come from the decision engine, never from an LLM.
        """
        return "gemini" if self.gemini_api_key.strip() else "deterministic"

    @property
    def model_path(self) -> Path:
        return BACKEND_DIR / self.model_dir

    @property
    def database_path(self) -> Path:
        return BACKEND_DIR / self.db_path

    @property
    def cache_path(self) -> Path:
        return BACKEND_DIR / self.cache_dir


@lru_cache
def get_settings() -> Settings:
    """Cached so .env is parsed once per process."""
    return Settings()


settings = get_settings()
