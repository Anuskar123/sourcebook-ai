"""Read-only readiness check for this project's native Windows stack.

Credentials stay in memory. No Gemini request, job creation or process mutation
is performed. Exit code 0 means every required local service was verified.
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import dotenv_values
from neo4j import GraphDatabase
from pymongo import MongoClient


def local_url(value):
    parsed = urlsplit(value)
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Native checks require loopback addresses")
    return value.rstrip("/")


def inspect_stack(repo):
    settings = dotenv_values(repo / ".env")
    runtime = repo.parent.parent / "work" / "runtime" / "native"

    def mongo():
        uri = local_url(settings["MONGODB_URI"])
        with MongoClient(uri, serverSelectionTimeoutMS=3000, connectTimeoutMS=3000,
                         socketTimeoutMS=3000) as client:
            client.admin.command("ping")
        return True

    def neo4j():
        with GraphDatabase.driver(local_url(settings["NEO4J_URI"]),
                auth=(settings.get("NEO4J_USER", "neo4j"), settings["NEO4J_PASSWORD"]),
                connection_timeout=3, connection_acquisition_timeout=3) as driver:
            driver.verify_connectivity()
        return True

    def http(base, path):
        with httpx.Client(timeout=3, trust_env=False, follow_redirects=False) as client:
            return client.get(local_url(base) + path).status_code == 200

    def worker():
        if os.name != "nt":
            return False
        records = json.loads((runtime / "processes.json").read_text())
        pid = int(records["worker"]["pid"])
        if pid <= 0:
            return False
        probe = subprocess.run(["powershell.exe", "-NoProfile", "-Command",
            f"(Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}').CommandLine"],
            capture_output=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
        return probe.returncode == 0 and str(repo / "services" / "worker" / "agent.py").lower() in probe.stdout.decode(errors="replace").lower()

    checks = [
        ("MongoDB authenticated connection", mongo),
        ("Neo4j authenticated connection", neo4j),
        ("Chroma readiness", lambda: http(settings.get("CHROMA_URL", "http://127.0.0.1:8000"), "/api/v2/heartbeat")),
        ("ML model readiness", lambda: http(settings.get("ML_API_URL", "http://127.0.0.1:8001"), "/health/ready")),
        ("Express readiness", lambda: http(settings.get("API_URL", "http://127.0.0.1:3000"), "/health/ready")),
        ("Frontend response", lambda: http(settings.get("WEB_ORIGIN", "http://127.0.0.1:5173"), "/")),
        ("Recorded worker process", worker),
        ("Gemini key configured (no API request)", lambda: bool(settings.get("GEMINI_API_KEY", "").strip())),
    ]

    def run(item):
        name, check = item
        try:
            ready = bool(check())
        except Exception:
            # Exception text can include credential-bearing database URLs.
            ready = False
        return name, ready

    with ThreadPoolExecutor(max_workers=len(checks)) as pool:
        results = list(pool.map(run, checks))
    for name, ready in results:
        print(f"{'OK' if ready else 'MISSING'}: {name}")
    if not all(ready for _, ready in results):
        print("Inspect LOCAL_RUNTIME.md and work/runtime/native logs for setup details.")
        return 1
    print("Native stack is ready. Gemini connectivity is checked separately by npm run smoke.")
    return 0


if __name__ == "__main__":
    sys.exit(inspect_stack(Path(__file__).resolve().parents[1]))
