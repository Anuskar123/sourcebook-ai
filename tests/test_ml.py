import sys
from pathlib import Path
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "ml"))
from main import app
from train_demo import train


def test_prediction_auth_validation_and_readiness(tmp_path, monkeypatch):
    artifact = tmp_path / "demo.joblib"
    train(artifact)
    monkeypatch.setenv("MODEL_PATH", str(artifact))
    monkeypatch.setenv("ML_API_TOKEN", "x" * 40)
    with TestClient(app) as client:
        assert client.get("/health/ready").json()["demo"] is True
        assert client.post("/predict", json={"text": "Python API"}).status_code == 401
        headers = {"X-Service-Token": "x" * 40}
        for text in ("", " ", "a" * 20001):
            assert client.post("/predict", json={"text": text}, headers=headers).status_code == 422
        response = client.post("/predict", json={"text": "Python software API programming"}, headers=headers)
        assert response.status_code == 200
        body = response.json()
        assert body["label"] == "technology"
        assert 0 <= body["confidence"] <= 1
        assert body["model_version"] == "demo-tfidf-v1"
