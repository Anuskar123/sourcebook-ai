"""Start this project's real databases and services on Windows without Docker.

Requires the Python dependencies, MongoDB executable, and the portable Neo4j/Java
archives described in LOCAL_RUNTIME.md. Data belongs to this project's work folder.
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from neo4j import GraphDatabase
from pymongo import MongoClient

repo = Path(__file__).resolve().parents[1]
work = repo.parent.parent / "work"
runtime = work / "runtime" / "native"
runtime.mkdir(parents=True, exist_ok=True)
env_file = repo / ".env"
settings = dotenv_values(env_file)
settings["MONGODB_URI"] = f"mongodb://root:{settings['MONGO_PASSWORD']}@127.0.0.1:27117/portfolio?authSource=admin"
settings["NEO4J_URI"] = "bolt://127.0.0.1:17687"
text = env_file.read_text(encoding="utf-8")
for key in ("MONGODB_URI", "NEO4J_URI"):
    text = re.sub(rf"^{key}=.*$", lambda _, key=key: key + "=" + settings[key], text, flags=re.MULTILINE)
env_file.write_text(text, encoding="utf-8")
child_env = {**os.environ, **{key: value for key, value in settings.items() if value is not None}, "ANONYMIZED_TELEMETRY": "False"}
java_candidates = list((work / "tools").glob("jdk-21*/bin/java.exe"))
if not java_candidates:
    raise SystemExit("Portable Java 21 was not found under work/tools")
java = java_candidates[0]
neo = work / "tools" / "neo4j-community-5.26.0"
mongo = Path(os.environ.get("MONGOD_PATH", "C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe"))
if not mongo.is_file() or not neo.is_dir():
    raise SystemExit("MongoDB or portable Neo4j is missing")
child_env["JAVA_HOME"] = str(java.parent.parent)
child_env["NEO4J_HOME"] = str(neo)
child_env["NEO4J_CONF"] = str(neo / "conf")
flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
record_path = runtime / "processes.json"
records = json.loads(record_path.read_text()) if record_path.exists() else {}


def listening(port):
    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def start(name, command, cwd=repo):
    output = (runtime / f"{name}.log").open("ab")
    process = subprocess.Popen([str(item) for item in command], cwd=cwd, env=child_env,
        stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, creationflags=flags)
    output.close()
    records[name] = {"pid": process.pid, "executable": str(command[0])}
    record_path.write_text(json.dumps(records, indent=2))
    print(f"Started {name}", flush=True)
    return process


def wait_for(check, name, seconds=60):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                print(f"Ready: {name}", flush=True)
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError(f"{name} did not become ready; inspect its log under work/runtime/native")


mongo_data = runtime / "mongo-data"
mongo_data.mkdir(exist_ok=True)
if not listening(27117):
    start("mongo", [mongo, "--dbpath", mongo_data, "--bind_ip", "127.0.0.1", "--port", "27117", "--auth", "--wiredTigerCacheSizeGB", "0.25"])
wait_for(lambda: listening(27117), "MongoDB listener")
try:
    with MongoClient(settings["MONGODB_URI"], serverSelectionTimeoutMS=3000) as client:
        client.admin.command("ping")
except Exception:
    # MongoDB's localhost exception permits bootstrapping the first administrator.
    with MongoClient("mongodb://127.0.0.1:27117", serverSelectionTimeoutMS=3000) as client:
        client.admin.command("createUser", "root", pwd=settings["MONGO_PASSWORD"], roles=[{"role": "root", "db": "admin"}])
with MongoClient(settings["MONGODB_URI"], serverSelectionTimeoutMS=3000) as client:
    client.admin.command("ping")
print("Authenticated MongoDB connection verified", flush=True)

if not listening(17687):
    (neo / "conf" / "neo4j.conf").write_text("\n".join([
        "server.default_listen_address=127.0.0.1",
        "server.bolt.enabled=true", "server.bolt.listen_address=127.0.0.1:17687",
        "server.bolt.advertised_address=127.0.0.1:17687",
        "server.http.enabled=true", "server.http.listen_address=127.0.0.1:17474",
        "server.http.advertised_address=127.0.0.1:17474", "server.https.enabled=false",
        "server.memory.heap.initial_size=256m", "server.memory.heap.max_size=512m",
        "server.memory.pagecache.size=128m", "dbms.usage_report.enabled=false", "",
    ]), encoding="utf-8")
    java_args = [java, "-cp", str(neo / "lib" / "*"), f"-Dbasedir={neo}"]
    if not (neo / "data" / "dbms" / "auth.ini").exists():
        # The password is passed in memory, and command/output are never printed.
        initialized = subprocess.run([str(x) for x in [*java_args, "org.neo4j.server.startup.Neo4jAdminCommand", "dbms", "set-initial-password", settings["NEO4J_PASSWORD"]]],
            cwd=neo, env=child_env, capture_output=True, creationflags=flags, timeout=30)
        if initialized.returncode != 0:
            raise RuntimeError("Neo4j initial credential setup failed")
    start("neo4j", [*java_args, "org.neo4j.server.startup.Neo4jCommand", "console"], cwd=neo)


def neo_ready():
    with GraphDatabase.driver(settings["NEO4J_URI"], auth=("neo4j", settings["NEO4J_PASSWORD"]), connection_timeout=2) as driver:
        driver.verify_connectivity()
    return True


wait_for(neo_ready, "Neo4j authenticated Bolt connection")
if not listening(8000):
    chroma = Path(sys.executable).parent / "chroma.exe"
    start("chroma", [chroma, "run", "--path", runtime / "chroma-data", "--host", "127.0.0.1", "--port", "8000"])


def http_ready(url):
    with httpx.Client(timeout=2, trust_env=False) as client:
        return client.get(url).status_code == 200


wait_for(lambda: http_ready("http://127.0.0.1:8000/api/v2/heartbeat"), "Chroma")
if not listening(8001):
    model_path = runtime / "classifier.joblib"
    if not model_path.exists():
        sys.path.insert(0, str(repo / "services" / "ml"))
        from train_demo import train
        train(model_path)
    child_env["MODEL_PATH"] = str(model_path)
    start("ml", [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"], cwd=repo / "services" / "ml")
wait_for(lambda: http_ready("http://127.0.0.1:8001/health/ready"), "ML inference")
if not listening(3000):
    start("api", [shutil.which("node"), repo / "services" / "api" / "server.js"])
wait_for(lambda: http_ready("http://127.0.0.1:3000/health/ready"), "Express API")
worker_entry = repo / "services" / "worker" / "agent.py"
worker_pid = records.get("worker", {}).get("pid")
worker_alive = False
if worker_pid:
    probe = subprocess.run(["powershell.exe", "-NoProfile", "-Command", f"(Get-CimInstance Win32_Process -Filter 'ProcessId = {int(worker_pid)}').CommandLine"], capture_output=True, creationflags=flags, timeout=10)
    worker_alive = str(worker_entry) in probe.stdout.decode(errors="replace")
if not worker_alive:
    start("worker", [sys.executable, worker_entry])
if not listening(5173):
    start("web", [shutil.which("node"), repo / "node_modules" / "vite" / "bin" / "vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], cwd=repo / "apps" / "web")
wait_for(lambda: http_ready("http://127.0.0.1:5173"), "React frontend")
print("Native stack is ready. Frontend: http://127.0.0.1:5173; Neo4j Browser: http://127.0.0.1:17474", flush=True)
