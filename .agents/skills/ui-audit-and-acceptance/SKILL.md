---
name: ui-audit-and-acceptance
description: Docomator-specific UI/UX acceptance gate for hierarchy, document workflows, state/recovery, control recomposition, offline web implementation, accessibility, motion and document/data invariants.
---

# Docomator UI Audit and Acceptance

Use this as the final quality gate for material UI changes or as a read-only audit.

Project requirements, ADRs, architecture, UX specification, branding/tokens, scoped `AGENTS.md` and real implementation/tests are evidence. Screenshot polish alone is never sufficient.

## Audit sequence

### 1. Primary job and work object

Identify the top user job and the real primary object:

- document/template canvas;
- generation composition and correction;
- extracted source + proposed dataset;
- result/operation register;
- source data/problem values.

The work object must visually and interactionally dominate secondary chrome.

### 2. Flow contract

For each primary flow verify:

`trigger → acknowledgement → pending → result → failure/recovery`

Record avoidable clicks, popup cycles, context switches and repeated choices.

### 3. Control recomposition

For any frequent cluster ask:

- which control is the primary independent choice?
- which choices are genuinely independent?
- which values are derived metadata/status?
- which actions exist only because controls commit incoherently?
- which rare options can be contextual without hiding current state?

Document-generation hotspots include template/group/mode/check/apply chains. Template-editor hotspots include permanent field/control walls that could become selection-driven inspector content.

Do not pursue minimum widget count; pursue minimum unnecessary decisions.

### 4. State coverage

Check applicable normal, focus, selected, disabled, loading, pending, stale, partial, empty, error, cancelled and recovery states.

Document-specific checks:

- stale preview/preflight after dependent input revision;
- persisted long-running operation after navigation/reload;
- partial generation with successful results retained;
- correction form values preserved after server failure;
- unsupported/degraded document preview;
- explicit import clearly separated from read-only analysis/preview.

### 5. Document/data truth

Verify as applicable:

- current space is visible when it changes data meaning;
- template/source/version identity is human-readable and unambiguous;
- browser DOM/pixel geometry is never persisted as Office binding truth;
- selected region maps to validated Document IR/binding coordinate;
- exact expected output count/mode is clear before launch;
- preflight cannot remain valid after dependent inputs change;
- immutable launched/result state is not silently changed by later edits;
- partial success is represented honestly;
- failed-only retry preserves successful results and prepared context;
- extraction automatic result and user corrections remain distinct;
- import errors expose structured row/column/raw value/action data;
- preview/read does not perform implicit mutation or create fields;
- explicit import/apply boundary is visible;
- cross-space selection/linking remains impossible.

### 6. Offline web implementation

Verify:

- existing HTML/CSS/JavaScript architecture is preserved;
- `brand-tokens.css` remains visual source of truth;
- no CDN/remote font/analytics/runtime external asset dependency;
- document-derived text is rendered as untrusted data;
- CSP/session/network conventions remain intact;
- backend/persisted state is not replaced by fake browser timers;
- page-level horizontal overflow is absent at 320 px and 200% zoom;
- two-dimensional scroll is contained inside explicit document/table surfaces only.

### 7. Accessibility and input

Check keyboard path, visible focus, focus return after dialogs/popovers, non-color state cues, ≥44×44 targets where required, screen-reader announcements where applicable, dark/light/system behavior, reduced motion and long Russian text.

A core action cannot be hover-only, gesture-only or pointer-only.

### 8. Motion

- keyboard row/cell/field selection is instant;
- routine transitions follow product motion tokens and never delay confirmed state;
- no button bounce/scale, page-flip, paper-flight, pulsing fields or staggered list entrance;
- rapid state changes converge on latest intent;
- reduced-motion removes nonessential movement;
- motion never changes selection identity, scroll context or stale/current interpretation.

### 9. Anti-slop regression

If a Design Direction Contract was used, verify:

- the defining document-native mechanism remains visible in the actual UI;
- implementation did not collapse into generic cards + selectors;
- domain invariants and offline implementation reality remain intact;
- decoration has informational, state or interaction purpose.

Paper colors and document icons do not make a generic dashboard document-specific.

## Severity

- `P0`: data-isolation/destructive/document-corruption risk or unusable core flow.
- `P1`: blocks/seriously slows a primary task, hides critical state, permits stale commit/preflight or destroys accepted interaction concept.
- `P2`: recurring friction, control fragmentation, incomplete states, reflow/accessibility defect or noticeable concept regression.
- `P3`: low-impact polish.

## Output

Report root causes, not symptom lists:

| Severity | Surface | User expectation | Actual problem | Evidence | Correction | Acceptance |
|---|---|---|---|---|---|---|

For control fragmentation include before/after decisions and semantic axes preserved. Then provide the top improvements by leverage, document-invariant status, anti-slop status if applicable, unverified items and acceptance sequence.

## Approval rule

Do not approve until primary flow, async/recovery state, keyboard/reflow behavior and applicable document/data invariants are exercised or explicitly marked unverified.

## Anti-patterns

- Approving by screenshot polish.
- Fixing every dropdown separately when the cluster is the problem.
- Hiding space/preflight/result truth to make UI visually minimal.
- Accepting a preview that looks right while its binding identity is unsafe.
- Treating one failed unit as whole-operation failure.
- Resetting file/mapping/composition after recoverable errors.
- Remote runtime assets in an offline product.
- Claiming unverified behavior as fact.
