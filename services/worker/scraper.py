import ipaddress
import socket
import time
from urllib.parse import urlsplit
import urllib3
from bs4 import BeautifulSoup


def scrape(url: str, allowed_hosts: set[str]) -> str:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in allowed_hosts or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Only approved HTTPS hosts are allowed")
    addresses = {item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(ip).is_global for ip in addresses):
        raise ValueError("Non-public DNS target rejected")
    # Pin the validated address while preserving hostname verification and TLS SNI.
    # Redirects and environment proxies are deliberately not followed.
    pool = urllib3.HTTPSConnectionPool(
        host=sorted(addresses)[0], port=443, server_hostname=host,
        assert_hostname=host, cert_reqs="CERT_REQUIRED",
        timeout=urllib3.Timeout(connect=5, read=10), retries=False,
    )
    response = None
    started = time.monotonic()
    try:
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        response = pool.request("GET", path, headers={"Host": host, "User-Agent": "PortfolioResearchBot/0.1", "Accept-Encoding": "identity"}, redirect=False, preload_content=False)
        if response.status != 200 or "text/html" not in response.headers.get("Content-Type", "").lower():
            raise ValueError("Expected a direct HTML response")
        if response.headers.get("Content-Encoding", "identity").lower() != "identity":
            raise ValueError("Compressed responses are not accepted")
        chunks, size = [], 0
        for chunk in response.stream(16384, decode_content=False):
            size += len(chunk)
            if size > 2_000_000 or time.monotonic() - started > 30:
                raise ValueError("Page exceeds fetch budget")
            chunks.append(chunk)
        soup = BeautifulSoup(b"".join(chunks), "html.parser")
        for tag in soup(["script", "style", "noscript", "nav", "footer"]):
            tag.decompose()
        text = soup.get_text(" ", strip=True)[:20000]
        if not text:
            raise ValueError("Empty page")
        return text
    finally:
        if response is not None:
            response.close()
        pool.close()
