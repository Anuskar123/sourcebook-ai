import socket
import sys
from pathlib import Path
import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "worker"))
from schemas import Extraction
from scraper import scrape
from agent import build_graph, LeaseLost


def test_references_are_validated():
    with pytest.raises(ValidationError):
        Extraction.model_validate({"summary": "test", "entities": [], "relationships": [{"source": "missing", "target": "missing", "relation": "USES"}]})


@pytest.mark.parametrize("url", ["http://example.com", "https://evil.test", "https://user:pass@example.com", "https://example.com:444"])
def test_unapproved_urls_rejected(url):
    with pytest.raises(ValueError):
        scrape(url, {"example.com"})


@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1"])
def test_private_dns_rejected(monkeypatch, address):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))])
    with pytest.raises(ValueError, match="Non-public"):
        scrape("https://example.com", {"example.com"})


def test_checkpoint_replay_skips_external_side_effects():
    class Jobs:
        def find_one(self, *args): return {"_id": "job"}
    import threading
    graph = build_graph({"_id": "job", "leaseToken": "token"}, Jobs(), None, None, {}, threading.Event())
    state = {"text": "saved", "extracted": {"summary": "saved"}, "prediction": {"label": "technology"}, "persisted": True, "indexed": True}
    assert graph.invoke(state) == state


def test_lost_lease_stops_before_network_calls():
    import threading
    lost = threading.Event()
    lost.set()
    graph = build_graph({"_id": "job", "leaseToken": "token"}, None, None, None, {}, lost)
    with pytest.raises(LeaseLost):
        graph.invoke({})


def test_full_graph_http_contracts_and_order(monkeypatch):
    import threading
    from types import SimpleNamespace
    import agent
    events, updates = [], []
    extraction = {"summary": "Python project", "entities": [{"name": "Python", "kind": "technology"}], "relationships": []}
    prediction = {"label": "technology", "confidence": 0.7, "model_version": "test-v1", "demo": True}
    class Jobs:
        def find_one(self, *args): return {"_id": "job"}
        def update_one(self, query, update):
            assert query["leaseToken"] == "lease"
            updates.append(update)
            return SimpleNamespace(matched_count=1)
    class Http:
        def post(self, url, **kwargs):
            if url.endswith(":generateContent"):
                events.append("extract")
                assert kwargs["headers"]["x-goog-api-key"] == "gemini-test-key"
                assert "source text" in kwargs["json"]["contents"][0]["parts"][0]["text"]
                assert kwargs["json"]["generationConfig"]["responseSchema"]["type"] == "OBJECT"
                return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": Extraction.model_validate(extraction).model_dump_json()}]}}]})
            if url.endswith("/predict"):
                events.append("classify")
                assert kwargs["headers"]["X-Service-Token"] == "ml-token"
                assert kwargs["json"] == {"text": "Python project"}
                return SimpleNamespace(raise_for_status=lambda: None, json=lambda: prediction)
            events.append("index")
            assert url == "http://api:3000/internal/jobs/job/index"
            assert kwargs["headers"]["X-Service-Token"] == "internal-token"
            assert kwargs["json"] == {"text": "source text", "leaseToken": "lease"}
            return SimpleNamespace(raise_for_status=lambda: None)
    class Session:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute_write(self, callback):
            events.append("persist")
            callback(self)
        def run(self, query, **params):
            assert "Python" not in query
            return SimpleNamespace(consume=lambda: None)
    graph_db = SimpleNamespace(session=lambda **kwargs: Session())
    def fake_scrape(*args):
        events.append("scrape")
        return "source text"
    monkeypatch.setattr(agent, "scrape", fake_scrape)
    env = {"GEMINI_API_KEY": "gemini-test-key", "ML_API_URL": "http://ml:8001", "API_URL": "http://api:3000", "ML_API_TOKEN": "ml-token", "INTERNAL_API_TOKEN": "internal-token", "SCRAPE_ALLOWED_HOSTS": "example.com"}
    job = {"_id": "job", "leaseToken": "lease", "ownerId": "owner", "url": "https://example.com"}
    result = build_graph(job, Jobs(), graph_db, Http(), env, threading.Event()).invoke({})
    assert events == ["scrape", "extract", "classify", "persist", "index"]
    assert len(updates) == 5
    assert result["indexed"] is True
