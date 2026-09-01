---
name: ui-skill-router
description: Project-local focused UI router for Docomator; selects the smallest relevant document-workstation skill set and keeps project requirements, offline web constraints and document truth authoritative.
---

# Docomator UI Skill Router

Use this router for material UI/UX work in Docomator. Do not load every skill. First classify the user job, primary work object, affected surface and scale of change.

Project-local authority always wins in this order: applicable `AGENTS.md`, `docs/REQUIREMENTS.md`, accepted ADRs, `docs/ARCHITECTURE.md`, `docs/UX_UI_SPECIFICATION.md`, `docs/BRANDING.md`, `docs/INTERFACE_HIERARCHY.md`, current implementation/tests, then reusable skills.

## Routes

### Primary work surface / navigation redesign

Use `anti-slop-ui-direction` first when changing the main document route, primary work surface, information architecture or a high-frequency flow. It must produce a compact Design Direction Contract before implementation.

Do not invoke this gate for a local label, spacing, state or one-control fix.

### Global document workstation / navigation / readiness

Use `document-workstation-ux`.

Preserve `Данные → Шаблон → Выпуск → Результат` as a factual readiness/navigation spine, not a rigid wizard. Current space remains persistent context. Known entry context is carried forward.

### Visual DOCX/XLSX template editor

Use `document-template-canvas-and-binding`; add `offline-web-interface-engineering` for implementation and `motion-feedback-and-microinteractions` only when interaction continuity is material.

The document canvas is the primary work object. Inspector is contextual. Persist only server-validated Document IR/binding coordinates, never browser DOM selectors or pixel geometry as Office truth.

### Create documents / generation flow

Use `document-generation-flow`; add `document-workstation-ux` for surrounding navigation/readiness and `offline-web-interface-engineering` for implementation.

Preserve prepared context through corrections/retry. Invalidate preflight immediately when dependent input changes. Show exact expected output count before launch. Keep successful immutable results on partial failure.

### Extraction / CSV-XLSX import review

Use `document-extraction-and-import-review`; add `document-template-canvas-and-binding` only when the result is visually linked to DOCX/XLSX source regions, and `offline-web-interface-engineering` for UI implementation.

Prefer automatic-first interpretation, focused correction, structured row/cell errors and explicit import commit. Never rebuild machine semantics by regexp parsing localized error messages.

### Concrete local web implementation

Use `offline-web-interface-engineering` plus exactly one primary document skill. Add `motion-feedback-and-microinteractions` only when motion/direct feedback is part of the task.

### Final audit

Use `ui-audit-and-acceptance` after any material UI implementation or as a read-only audit.

## Local interaction recomposition

When several controls implement one frequent user intent, do not fix them independently. Map:

- primary choice/navigation axis;
- independent secondary choice;
- action;
- derived metadata/status;
- rare override.

Then remove only derived/redundant controls, move rare controls into contextual disclosure, and preserve independent semantics. Typical Docomator examples are template/group/mode/check chains, permanent template inspectors, and import mapping controls.

The target is fewer unnecessary decisions and popup cycles, not minimum widget count.

## State rules

Every affected async flow defines applicable loading, pending, stale, partial, empty, error, cancelled and recovery states.

- preserve user input after recoverable server errors;
- old preview/preflight cannot remain visually current after dependent input changes;
- stale async completions cannot overwrite newer user intent;
- persisted operations restore from backend after navigation/reload;
- no invented percentages or browser-only fake progress.

## Hard rules

1. Do not route Docomator UI to Qt/QML/Qwt or meteorological skills.
2. Do not introduce a frontend framework merely to satisfy a design pattern.
3. Document/browser projection never becomes Office/storage source of truth.
4. Space context and cross-space invariants cannot be hidden or weakened by simplification.
5. Preview/read does not perform hidden mutation.
6. Explicit import and immutable generation launch remain clear commit boundaries.
7. User input and prepared generation/import context survive recoverable errors.
8. One dominant primary action per state; secondary actions must not visually compete.
9. Keyboard selection/navigation is immediate; motion never delays confirmed state.
10. Finish material work with `ui-audit-and-acceptance` and repository-native tests.

## Routing output

Before material work record internally:

- primary user job;
- primary work object;
- affected surface;
- local fix vs primary-surface redesign;
- selected skill(s);
- project requirements/ADRs that constrain the change;
- why other skills are unnecessary.

## Anti-patterns

- Loading all skills because the task says “design”.
- Applying a generic dashboard/card template to a document workflow.
- Treating anti-slop as a palette or rounded-control style.
- Exposing backend decomposition as a chain of selectors.
- Turning a document preview into an HTML editor source of truth.
- Reusing stale preflight because the UI still looks valid.
- Resetting file/mapping/selection/composition after one error.
- Adding motion or new framework machinery instead of fixing hierarchy/flow.
