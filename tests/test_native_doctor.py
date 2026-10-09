import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("doctor_native",
    Path(__file__).resolve().parents[1] / "scripts" / "doctor-native.py")
doctor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(doctor)


def test_native_checks_refuse_remote_destinations():
    for url in ("https://example.com", "http://127.0.0.1.example.com", "mongodb://root:secret@10.0.0.1/db"):
        with pytest.raises(ValueError):
            doctor.local_url(url)
    assert doctor.local_url("http://127.0.0.1:3000/") == "http://127.0.0.1:3000"


def test_failure_reporting_does_not_disclose_credentials(tmp_path, monkeypatch, capsys):
    secret = "test-password-that-must-never-appear"
    config = {
        "MONGODB_URI": f"mongodb://root:{secret}@example.com/db",
        "NEO4J_URI": "bolt://example.com:7687",
        "NEO4J_PASSWORD": secret,
        "CHROMA_URL": "http://example.com",
        "ML_API_URL": "http://example.com",
        "API_URL": "http://example.com",
        "WEB_ORIGIN": "http://example.com",
        "GEMINI_API_KEY": secret,
    }
    monkeypatch.setattr(doctor, "dotenv_values", lambda _: config)
    assert doctor.inspect_stack(tmp_path) == 1
    output = capsys.readouterr().out
    assert "MISSING: MongoDB" in output
    assert secret not in output
    assert "example.com" not in output
