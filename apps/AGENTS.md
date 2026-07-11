# Application-service rules

- Keep HTTP concerns in `apps/api` and background/side-effect work in `apps/worker`.
- API handlers must be thin: parse/authorize, call an application service, serialize.
- Do not run LLM, LibreOffice, large ZIP processing, SMTP, or network-share writes inside an HTTP request.
- Entry points must handle SIGTERM/SIGINT and bound graceful shutdown.
- Add Fastify inject tests for routes and deterministic unit tests for worker loops.
