# Security and private data

Never commit .env, real credentials, database exports, source snapshots, logs, or generated model artifacts. The example environment contains placeholders only. npm run setup generates independent local secrets without printing them. Gemini credentials stay in backend services.

Rotate any credential that was exposed in chat, a log, or a previous repository. Removing a file from the latest commit does not remove it from Git history.

Keep the local Compose ports on loopback. Before internet deployment, review the production boundaries in README.md, configure TLS and a secret manager, use least-privilege database identities, and enforce network egress controls.

The scraper accepts exact approved HTTPS hostnames and rejects private addresses and redirects. Website content is untrusted. Do not broaden the allowlist to bypass those controls.

If you identify a security issue, do not include working credentials or private source content in a public issue. Use GitHub private vulnerability reporting if available; otherwise contact the maintainer privately before sharing sensitive details.
