# Оформлятор: инструкции для агентов

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
- No `eval`, `Function`, arbitrary dynamic imports from untrusted input, or user-defined executable expressions.
- Applied SQL migrations and activated template versions are immutable.
- Every external side effect needs a correlation ID and idempotency key.
- Generated legal/content text requires review unless an explicit approved policy says otherwise.
- SMTP and network destinations are allowlisted.
- Network share writes must verify mount + sentinel and use temp-file/atomic-rename semantics.
- Keep the modular monolith. Do not introduce a broker, cache server, microservice, or vector database without measured need and an ADR.
- ADR-0011 defines one shared 4-digit application access code. Оформлятор still has no login, user accounts, roles, personal cabinets or section-level ACL: every client with the code works with the same shared data. Do not turn the access-code gate into IAM without a superseding ADR.
- The 4-digit code is only an anti-accidental-access barrier inside the trusted corporate perimeter; it must not be presented as Internet-grade authentication or replace firewall/reverse proxy/HTTPS.
- Spaces are hard data partitions, not authorization scopes. The access-code gate must never weaken or replace `spaceId` validation and database isolation.

## Repository structure

- `apps/api`: Fastify HTTP adapter and request lifecycle.
- `apps/api/ui`: offline guided UI; follow `apps/api/ui/AGENTS.md` and `docs/UX_UI_SPECIFICATION.md`.
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
- Never log access codes, credential/password hashes, SMTP passwords, session secrets, raw authorization headers, session cookies or restricted values.

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

## UI rules

- A user must never have to infer whether an operation started, is waiting, failed, or completed.
- Implement applicable loading, empty, success, warning, error, degraded, disabled, and planned states.
- State copy explains the current step, why it is happening, what comes next, and whether data is preserved.
- Preserve form values after server errors and expose correlation IDs.
- Keep runtime UI offline: no CDN, remote fonts, analytics, or external assets.
- Expired access session must lead to the one-field «Код доступа» screen without losing the user's understanding of what happened; after successful code entry the user returns to a safe local path.
- The access screen must not ask for a username/login or separate password and must not trigger HTTP Basic Auth/`WWW-Authenticate`.

- User-facing interface, API messages, installation help, notifications, roles, and states are Russian by default.
- Do not expose raw English library/database errors or unexplained machine values to ordinary users.
- Run `npm run check:language` for every user-facing change.
- Verify 320 px, keyboard/focus, touch targets, dark mode, and reduced motion.

## Offline-release rules

- `prepare-bundle.sh` may use the network only on the connected build host.
- `install.sh`, `update.sh` and bundle verification must never use the network.
- Verify SHA-256 before system changes.
- Install into versioned immutable directories and switch an atomic symlink.
- Back up database/config before migration and roll back on failed readiness.
- A new installation must remain locked until the shared 4-digit access code is explicitly configured on the target host; updates must preserve the credential hash and session secret unless the operator changes the code.
- The canonical installed recovery path is `sudo /opt/docomator/current/first-run.sh --reset-code`; it must not require the old code and must not change user data.
- Product versioning follows `docs/VERSIONING.md`: use `npm run version:bump -- patch` for backward-compatible fixes and `-- minor` for new compatible capabilities. Do not keep an old product version merely because release maturity is still `candidate`.
- `version` describes the product capability/compatibility set; `status` and `channel` describe release maturity. A `candidate/pilot` release may and must receive a new SemVer when product behavior changes.
- Product-changing PRs must update `RELEASE_IDENTITY.json.version`; CI rejects a runtime/product change that keeps the previous version. A pure `candidate/pilot → stable/production` maturity transition may retain the same version when product behavior is unchanged.
- Quote shell variables; use `set -Eeuo pipefail`; run `bash -n` for every changed shell script.

## Definition of done

A change is done when:

- requirement IDs are satisfied or explicitly deferred;
- code, tests and docs agree;
- error/fallback paths are implemented;
- security and offline impact are reviewed;
- product-changing behavior has the SemVer bump required by `docs/VERSIONING.md`;
- `npm run check` passes;
- migration/rollback notes are present when applicable;
- roadmap status is updated when a milestone changes.

## GitHub write workflow

- Для изменений удалённого репозитория сначала обнаружить доступные GitHub write actions; отсутствие `gh`, локального OAuth-токена или локального `.git` не означает отсутствие возможности коммита.
- Перед изменением получить точный `refs/heads/main`, нормативные документы, открытые Issues, последние commits и CI.
- Создать короткую рабочую ветку от проверенного SHA `main`; не использовать прямое изменение `main` вместо обычного PR.
- Для нескольких связанных файлов предпочтителен один атомарный commit через `create_blob → create_tree → create_commit → update_ref`. `update_file` допустим для одиночного файла.
- После commit проверить `compare_commits`, открыть PR в `main` и дождаться всех обязательных jobs. Локальные/фокусные проверки не заменяют полный CI.
- Перед merge повторно проверить head SHA, mergeability, review threads и обязательные checks. Сливать squash-методом с `expected_head_sha`.
- После merge получить новый `refs/heads/main` и дождаться успешного post-merge CI на этом exact SHA.
- Не сообщать о commit, push, PR, merge или зелёном CI, пока соответствующий объект фактически не получен через GitHub API.
- Если write actions действительно отсутствуют после discovery, прямо сообщить об этом; не подменять удалённый commit локальным patch и не придумывать SHA.
