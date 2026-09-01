---
name: document-workstation-ux
description: Design a calm document-automation workstation around data, templates, deterministic generation and results, with document-specific navigation, provenance, state truth and fast access instead of generic dashboard UI.
---

# Document Workstation UX

A document-automation product is an operational workstation. The user comes to prepare, bind, generate, check and retrieve documents — not to operate database entities, OOXML internals or a dashboard of unrelated cards.

Use this skill for docomator and document-centric primary surfaces.

## Primary questions

The interface should answer quickly:

- What document am I preparing or creating?
- Which data and template will be used?
- What is already ready and what still needs attention?
- How many documents or files will be produced?
- Is the current preview/check still valid for the selected inputs?
- What is the system doing now, and can I safely leave this screen?
- Where will the result appear?
- If something failed, what was preserved and what should I do next?

If the user has to infer these answers from technical IDs, disabled controls, generic spinners or several disconnected cards, the hierarchy is wrong.

## Defining navigation mechanism

For Оформлятор, treat the durable route as:

`Данные → Шаблон → Выпуск → Результат`

This is a navigation and readiness spine, not a mandatory four-page wizard for every action.

Rules:

- entering from a template, group or prior result should carry known context forward;
- do not ask again for a value that is already unambiguous;
- the current space is persistent context, not another repeated wizard step;
- a user may jump back to a completed stage to correct source data or a template;
- the route shows factual state from the backend, not decorative completion marks.

A focused sub-flow may have its own local steps, for example `Документ → Поля → Проверка → Готово`, while the global document route remains stable.

## Primary work object by surface

Choose one dominant work object rather than surrounding the screen with equal-weight panels:

- template setup → the document/template canvas;
- document generation → the generation plan: template + audience + expected result;
- data correction → the actual missing/problem values;
- extraction/import → the interpreted source document and proposed dataset;
- results → the operation/result register and the selected immutable result.

Controls support the work object. They are not the work object.

## Information hierarchy

Default priority for a document workflow:

1. current work object and its actual state;
2. one primary next action;
3. current route/step and persistent space context;
4. blocking problems or missing values at their source;
5. expected output count/mode and important provenance;
6. secondary options in contextual disclosure;
7. diagnostics, machine IDs and implementation details on demand.

Use document-like surfaces, register rows, alignment and thin separators before adding cards. A document workstation should not look like a marketing landing page or database administration console.

## Document identity and provenance

Expose human-readable identity where it affects a decision:

- template name and file type;
- active/draft version state when relevant;
- selected data scope: all, group or explicit selection;
- generation mode in user language;
- exact expected output count;
- current space;
- preview/check status and whether it is current;
- operation state and result availability.

Keep SHA-256, UUID, OOXML coordinates, storage keys and correlation IDs in diagnostic disclosure unless the user needs them to recover or communicate a problem.

Never hide provenance merely to make the UI look minimal. Minimalism means removing unnecessary decisions, not removing truth.

## Fast access

Frequent actions should be direct and predictable:

- selecting a template or group uses searchable human labels when the set is large;
- entering generation from a template/group should prefill that context;
- after a blocking data error, the correction action should lead directly to the affected values;
- after success, the result/download action should be immediately available;
- retry should preserve the prepared composition and, for partial failures, target failed units only when the domain contract supports it;
- rare advanced settings belong in an inspector, disclosure or dedicated settings surface.

Do not add a permanent toolbar button for every backend capability. Measure the top tasks and keep those actions close to the object they affect.

## State truth

Every long-running document operation has an explicit lifecycle. Use persisted backend truth where available.

A user-visible operation should communicate:

- what has started;
- current stage in human language;
- what is already complete;
- what comes next;
- whether input/current data is preserved;
- whether the user can leave the page;
- whether cancellation is safe;
- final result or concrete recovery action.

Do not invent percentages. Do not report success before the server confirms it. Do not blank a useful preview merely because a replacement is pending.

## Context preservation

When the user changes a template, audience, generation mode, correction or binding:

- preserve unaffected choices and entered data;
- invalidate only dependent preview/preflight state;
- mark the new target as pending instead of displaying stale output as current;
- keep the old result visible only if it is clearly labeled as previous/stale;
- never silently reuse a preflight that was computed from different inputs.

## Motion and micro-feedback

Motion explains state or continuity; it never competes with the document.

- keyboard selection, field highlighting and row navigation are instant;
- hover/focus/ordinary state transitions are short and tokenized, typically around 120–160 ms when the project contract permits them;
- a contextual inspector may appear with a short origin-consistent transition if it improves orientation;
- inline error disclosure may use a subtle opacity/size transition only if layout remains stable;
- results appear as soon as ready; never hold them for an animation cycle;
- do not scale buttons on press, stage theatrical page entrances, pulse document icons or animate decorative backgrounds;
- `prefers-reduced-motion` removes nonessential spatial motion.

## Patterns

- Route-led document workbench with one factual next action.
- Document/template canvas plus contextual inspector rather than a wall of permanent configuration.
- Result register ordered by attention: error/partial/pending/running/completed according to product policy.
- Pre-filled entry points from template, group or previous operation.
- Inline correction that preserves generation context.
- Human labels first, diagnostics second.
- One dominant primary action per state.

## Anti-patterns

- Generic KPI/dashboard cards as the home of a document workflow.
- Treating `space`, template IDs, binding IDs or result IDs as user navigation.
- Four fixed wizard pages even when two steps are already known.
- Several equally bright actions competing for the next step.
- Hiding expected output count until after generation starts.
- Reusing stale preview/preflight after inputs change.
- Global spinner for a local document check.
- Decorative paper animations, AI sparkles, glassmorphism or giant pill controls.
- Making rare diagnostics permanently consume document-canvas width.
- Motion that delays frequent or keyboard-driven work.

## Acceptance scenarios

A user should be able to:

1. identify current space, work object, readiness and next action in a few seconds;
2. start from a known template/group without re-entering the same context;
3. see the expected number and kind of output before committing generation;
4. correct a blocking value without losing the prepared release;
5. distinguish current preview/preflight from stale/previous output;
6. leave a persisted long-running operation and find it again in results;
7. retry a recoverable failure without rebuilding the whole flow;
8. complete the primary route with keyboard only;
9. use the same semantics at 320, 768 and 1440 px, at 200% text zoom, in light/dark theme and with reduced motion.
