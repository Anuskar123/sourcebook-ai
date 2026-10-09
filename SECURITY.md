# Security and private data

Never commit .env, real credentials, database exports, source snapshots, logs, or generated model artifacts. The example environment contains placeholders only. npm run setup generates independent local secrets without printing them. Gemini credentials stay in backend services.

Rotate any credential that was exposed in chat, a log, or a previous repository. Removing a file from the latest commit does not remove it from Git history.

Keep the local Compose ports on loopback. Before internet deployment, review the production boundaries in README.md, configure TLS and a secret manager, use least-privilege database identities, and enforce network egress controls.

The scraper accepts exact approved HTTPS hostnames and rejects private addresses and redirects. Website content is untrusted. Do not broaden the allowlist to bypass those controls.

## Known Chroma dependency alerts

Reviewed on 2026-10-09: GitHub reports four open alerts for the pinned chromadb 1.5.0 dependency in requirements-native.txt, including two critical code-injection findings and two high-severity authorization findings. The local Compose file also pins Chroma 1.5.0. These findings have not been resolved or dismissed.

The [pre-authentication advisory GHSA-f4j7-r4q5-qw2c](https://github.com/advisories/GHSA-f4j7-r4q5-qw2c) currently lists affected versions through 1.5.9 and no patched release. The [authenticated code-injection advisory](https://github.com/advisories/GHSA-36p7-vc44-83pf) also lists no patched version. A source-code fix is not proof of a patched release or of complete remediation.

Keep Chroma accessible only to trusted local services and do not expose its port to the internet or untrusted clients. The existing loopback binding is a development boundary, not a production security guarantee. Internet deployment requires a reviewed remediation or alternative, an isolated service network, and verification of the selected server implementation and dependency versions. Passing functional CI does not close these alerts.

If you identify a security issue, do not include working credentials or private source content in a public issue. Use GitHub private vulnerability reporting if available; otherwise contact the maintainer privately before sharing sensitive details.
