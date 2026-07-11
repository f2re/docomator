# Docomator agent instructions

## Mission

Build an offline-first, auditable document automation platform for Debian/Astra Linux. The system must connect arbitrary supported DOCX/XLSX templates, resolve extensible entity properties, render deterministically, automate by schedule/event, and deliver through controlled local channels.

## Source-of-truth order

1. `docs/REQUIREMENTS.md`
2. accepted files in `docs/adr/`
3. `docs/ARCHITECTURE.md`
4. `docs/IMPLEMENTATION_PLAN.md`
5. `docs/ROADMAP.md`
6. `README.md`

Do not silently weaken a MUST requirement. Update requirements and add an ADR when a task changes an architectural boundary.

## Non-negotiable constraints

- Runtime must work without Internet access.
- LLM output is untrusted data. Never execute model-generated JavaScript, SQL, shell, paths, HTML, OOXML, or commands.
- File mutation, scheduling, validation, and delivery must be deterministic backend operations.
- No `eval`, `Function`, arbitrary dynamic imports, or user-defined executable expressions.
- Applied SQL migrations and activated template versions are immutable.
- Every external side effect needs a correlation ID and idempotency key.
- Generated legal/content text requires review unless an explicit approved policy says otherwise.
- SMTP and network destinations are allowlisted.
- Network share writes must verify mount + sentinel and use temp-file/atomic-rename semantics.
- Keep the modular monolith. Do not introduce a broker, cache server, microservice, or vector database without measured need and an ADR.

## Repository structure

- `apps/api`: Fastify HTTP adapter and request lifecycle.
- `apps/worker`: scheduler, queue consumers, orchestration and external side effects.
- `packages/*`: reusable domain/application contracts and adapters.
- `migrations`: immutable SQLite migrations.
- `scripts/offline`: connected-host bundle creation and network-free target install/update.
- `docs`: normative requirements, architecture, plans, operations and ADRs.

## Working method

1. Map the task to requirement IDs.
2. Inspect the relevant execution path and tests before editing.
3. Prefer the smallest complete vertical change.
4. Keep domain policy separate from transport/storage adapters.
5. Add or update tests with the implementation.
6. Update docs/roadmap when behavior or status changes.
7. Run the relevant checks before reporting completion.

Use subagents for independent read-heavy work, security review, test-gap analysis and documentation verification. Avoid concurrent write-heavy agents in overlapping directories. The parent agent owns integration and final validation.

## Commands

```bash
npm ci
npm run check
DOCOMATOR_DATA_DIR="$PWD/.tmp/data" npm run migrate
bash scripts/ci/validate-shell.sh
```

For a quick focused check, run the workspace build/test, but run `npm run check` before a PR is considered complete.

## TypeScript rules

- Keep `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` green.
- Avoid `any`; use `unknown` plus validation.
- Validate all boundary data before it enters the domain.
- Do not perform side effects at module import time except executable entrypoints.
- Handle SIGTERM/SIGINT and bounded shutdown in long-running processes.
- Use UTC ISO timestamps internally; store timezone separately where schedules require it.
- Never log credentials, raw authorization headers, session cookies or restricted values.

## SQLite and queue rules

- Enable foreign keys, WAL, busy timeout and short transactions.
- Do not hold a transaction during LLM, Office, SMTP or filesystem work.
- Claims use leases; retries are explicit; duplicate suppression uses unique constraints.
- Migrations are additive by default and checksum-protected.
- Add a new migration instead of editing an applied one.

## Document-engine rules

- Parse OOXML as untrusted ZIP/XML.
- Enforce compressed size, expanded size, entry count and path checks.
- LLM receives Document IR, never raw executable relationships or direct filesystem access.
- Verify all returned block IDs, offsets, cells and ranges before compiling bindings.
- Preserve untouched package parts in safe-patch mode.
- Every renderer change needs representative DOCX/XLSX fixtures and reverse-read validation.

## Offline-release rules

- `prepare-bundle.sh` may use the network only on the connected build host.
- `install.sh`, `update.sh` and bundle verification must never use the network.
- Verify SHA-256 before system changes.
- Install into versioned immutable directories and switch an atomic symlink.
- Back up database/config before migration and roll back on failed readiness.
- Quote shell variables; use `set -Eeuo pipefail`; run `bash -n` for every changed shell script.

## Definition of done

A change is done when:

- requirement IDs are satisfied or explicitly deferred;
- code, tests and docs agree;
- error/fallback paths are implemented;
- security and offline impact are reviewed;
- `npm run check` passes;
- migration/rollback notes are present when applicable;
- roadmap status is updated when a milestone changes.
