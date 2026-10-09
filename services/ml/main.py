import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

import joblib
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=20000)


class PredictResponse(BaseModel):
    label: str
    confidence: float = Field(ge=0, le=1)
    model_version: str
    demo: bool


@asynccontextmanager
async def lifespan(app):
    token = os.environ.get("ML_API_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("ML_API_TOKEN must contain at least 32 characters")
    path = Path(os.environ.get("MODEL_PATH", "models/classifier.joblib"))
    # joblib uses pickle: load only a trusted, release-controlled artifact.
    artifact = joblib.load(path)
    if not all(k in artifact for k in ("model", "version", "demo")):
        raise RuntimeError("Invalid model artifact")
    artifact["model"].predict_proba(["startup readiness probe"])
    app.state.artifact, app.state.token = artifact, token
    yield
    app.state.artifact = None


app = FastAPI(title="Portfolio classifier", version="0.1.0", lifespan=lifespan)


def authorize(request: Request, x_service_token: str = Header(default="")):
    if not secrets.compare_digest(x_service_token.encode(), request.app.state.token.encode()):
        raise HTTPException(status_code=401, detail="Invalid service credential")


@app.get("/health/live")
def live():
    return {"status": "ok"}


@app.get("/health/ready")
def ready(request: Request):
    if not getattr(request.app.state, "artifact", None):
        raise HTTPException(status_code=503, detail="Model unavailable")
    return {"status": "ready", "model_version": request.app.state.artifact["version"], "demo": request.app.state.artifact["demo"]}


@app.post("/predict", response_model=PredictResponse, dependencies=[Depends(authorize)])
def predict(body: PredictRequest, request: Request):
    artifact = request.app.state.artifact
    model = artifact["model"]
    probabilities = model.predict_proba([body.text])[0]
    best = int(probabilities.argmax())
    return PredictResponse(label=str(model.classes_[best]), confidence=float(probabilities[best]), model_version=artifact["version"], demo=artifact["demo"])
