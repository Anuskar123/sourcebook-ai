# Local runtime

Use Node 22.12 or newer and Docker Engine with Compose v2. On Windows, Docker Desktop needs its WSL 2 backend running.

```sh
npm run setup
# Edit .env locally: add your own GEMINI_API_KEY and permitted SCRAPE_ALLOWED_HOSTS.
npm run doctor
npm start
npm run status
```

Open http://localhost:5173 and create an account. Add an approved HTTPS page, wait until indexing completes, then ask about its contents. A completed source belongs to the signed-in account.

To approve another website, add its exact public hostname to the comma-separated SCRAPE_ALLOWED_HOSTS value in your local .env. For example, example.com,www.example.com approves those two names. Subdomains are not automatically included. Only approve sources you are permitted to fetch. Redirects and private network addresses are refused. Apply the change with:

```sh
docker compose --profile app up -d --force-recreate api worker
```

Run npm run logs to inspect service logs. Logs and source text may contain private information; do not upload them. npm stop preserves named database volumes. Removing volumes deletes local data.

For host development, start the default infrastructure with docker compose up --build -d, then use npm run dev:api, npm run dev:web and a Python 3.12 environment for services/worker/agent.py. Host database URLs must match local ports and generated credentials.

The optional Windows native scripts require separately installed MongoDB, Java 21 and Neo4j, plus the Python packages in requirements-native.txt. They are developer utilities that expect portable tools under a workspace work/tools directory. Docker Compose is the supported quick-start path.
