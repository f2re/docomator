---
name: anti-slop-ui-direction
description: Concept gate for substantial UI redesigns in Оформлятор; derives a document-native interaction mechanism, rejects generic dashboard styling and preserves deterministic document/data boundaries before implementation.
---

# Anti-Slop UI Direction for Оформлятор

Use this skill only before substantial changes to a primary surface, information architecture, navigation model or high-frequency document workflow. It is a concept gate, not a visual theme.

Project requirements, accepted ADRs, architecture, UX specification, branding/tokens and current implementation are authoritative.

## 1. State the job and primary work object

Record the user's operational job and name the primary work object. In Оформлятор this is normally one of:

- source data/problem values;
- document/template canvas;
- generation composition and its preflight;
- extracted source + proposed dataset;
- operation/result register.

Controls are not the primary work object.

## 2. Consider genuinely different mechanisms

Concepts must differ in organizing logic, not palette or component styling.

Useful mechanisms include:

### Route-led workbench

`Данные → Шаблон → Выпуск → Результат` is the readiness/navigation spine. Current factual state and next action are visible; known context is carried forward.

### Document canvas + contextual inspector

The document itself is the interaction surface. Selection drives a compact inspector; validated document coordinates remain source of truth.

### Result/operation register

For repeat operational work, immutable operations/results and attention state organize the screen. Errors/partial/running/completed items remain findable without card sprawl.

Different surfaces may use different supporting mechanisms. Do not force all three onto every screen.

Invalid alternatives are sidebar-left/sidebar-right, cards/fewer-cards, dark/light, rounded/square, or the same wizard with different spacing.

## 3. Rejection tests

### Genericity

Mentally replace template/audience/results with unrelated business labels. If the primary surface still works unchanged, the concept is probably generic.

A document-native concept should depend on real domain mechanisms such as document-region binding, exact generation composition, revision-bound preflight, source-linked extraction or immutable results.

### Templateability

If another product can be created by changing labels, icons and accent color only, the organizing logic is too template-driven.

### Domain truth

The concept must preserve as applicable:

- current space/context when it changes data meaning;
- template/source/version identity;
- validated Document IR coordinates instead of browser DOM as binding truth;
- stale/current preview and preflight revision;
- exact expected output count/mode;
- explicit preview/import and check/launch commit boundaries;
- immutable launched/result identity;
- structured import errors and partial/retry state;
- untrusted document/LLM boundary;
- deterministic renderer and no hidden mutation on read.

Novelty never outranks these invariants.

### Implementation reality

The concept must map cleanly to the existing offline HTML/CSS/JavaScript UI, semantic controls, `brand-tokens.css`, CSP, keyboard/focus contract and Playwright/axe acceptance.

Reject concepts requiring a new frontend framework, brittle absolute positioning, pointer-only operation, fake WYSIWYG fidelity, remote runtime assets or a second client-side source of truth.

## 4. Select one defining mechanism

Write a concise statement of the defining operational idea. Choose one primary mechanism and at most one or two supporting mechanisms. A layout, palette, blur, animation or component name is not a defining mechanism.

## 5. Constraint classes

- **FORBIDDEN** — violates correctness, security, space isolation, accessibility, offline or deterministic document contracts.
- **REJECT BY DEFAULT** — generic/decorative default with poor task justification.
- **ALLOW WITH JUSTIFICATION** — standard pattern whose purpose and interaction contract are explicit.

## Design Direction Contract

Before implementation record a compact handoff with:

- primary job;
- primary work object;
- defining mechanism;
- three concepts considered;
- selected concept and reason;
- genericity/templateability/domain-truth/implementation-reality result;
- invariants;
- non-goals;
- primary skills.

Keep this as a concise decision record, not a brainstorming transcript.

## Handoff

After the gate route through `ui-skill-router`. Implementation may refine details but must not silently replace the defining mechanism. If real implementation evidence invalidates the concept, explicitly reopen the gate.

After material implementation run `ui-audit-and-acceptance` and verify that the real UI did not collapse back into generic cards + selectors + decorative polish.

## Patterns

- Concept before component inventory.
- Document/data structure drives the work surface.
- One defining mechanism, few supporting mechanisms.
- Standard controls remain standard; document-specificity belongs in organizing logic.
- Project-local authority outranks reusable examples.

## Anti-patterns

- “Modernize” translated into cards, glass, pills or gradients.
- Three cosmetically different versions of the same screen.
- Paper-colored generic dashboard called document-specific.
- Decorative AI sparkle/magic as product identity.
- Browser preview made authoritative because it looks WYSIWYG.
- Simplification that hides stale preflight, space context or immutable result truth.
- Downstream implementation silently replacing the accepted concept.
