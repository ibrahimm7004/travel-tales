from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.utils.config import settings
from backend.db import engine, Base
from backend.routes.auth import router as auth_router
from backend.routes.photos import router as photos_router


app = FastAPI(title="TravelTales API", version="0.1.0")

# Ensure models are imported and tables are created at import time (helps tests)
import backend.models  # noqa: F401
Base.metadata.create_all(bind=engine)


@app.get("/health")
def health_check():
    return {"status": "ok"}


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Routers
app.include_router(auth_router)
app.include_router(photos_router)


@app.on_event("startup")
def on_startup():
    # Create DB tables (idempotent)
    Base.metadata.create_all(bind=engine)
