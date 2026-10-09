"""Download official, checksum-verified Java and Neo4j archives for native startup."""
from pathlib import Path
import hashlib
import zipfile
import httpx

repo = Path(__file__).resolve().parents[1]
tools = repo.parent.parent / "work" / "tools"
tools.mkdir(parents=True, exist_ok=True)

def download(url, name, expected_hash):
    target = tools / name
    if not target.exists():
        with httpx.stream("GET", url, follow_redirects=True, timeout=60) as response:
            response.raise_for_status()
            with target.open("wb") as handle:
                for chunk in response.iter_bytes(1024 * 1024):
                    handle.write(chunk)
    if hashlib.sha256(target.read_bytes()).hexdigest() != expected_hash:
        raise RuntimeError(f"Checksum verification failed for {name}")
    with zipfile.ZipFile(target) as bundle:
        for member in bundle.infolist():
            if not (tools / member.filename).resolve().is_relative_to(tools.resolve()):
                raise RuntimeError("Archive path escapes the intended tools directory")
        bundle.extractall(tools)
    print(f"Prepared {name}")

with httpx.Client(timeout=30, follow_redirects=True) as http:
    response = http.get("https://api.adoptium.net/v3/assets/latest/21/hotspot", params={"architecture": "x64", "image_type": "jre", "os": "windows", "vendor": "eclipse"})
    response.raise_for_status()
    package = response.json()[0]["binary"]["package"]
    download(package["link"], "java21.zip", package["checksum"])
    neo_url = "https://dist.neo4j.org/neo4j-community-5.26.0-windows.zip"
    checksum = http.get(neo_url + ".sha256")
    checksum.raise_for_status()
    neo_hash = checksum.text.split()[0]
    if len(neo_hash) != 64:
        raise RuntimeError("Invalid Neo4j checksum response")
    download(neo_url, "neo4j.zip", neo_hash)
