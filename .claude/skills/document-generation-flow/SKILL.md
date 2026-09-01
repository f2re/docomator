---
name: document-generation-flow
description: Design Docomator's document-generation journey from template and audience through preflight, correction, immutable launch, progress, partial failure, retry and results without losing prepared context or exposing backend choreography.
---

# Document Generation Flow

Use this skill for the `Создать документы` / release flow.

The user intent is:

`Create the right documents for the right data set, verify that they can be created, then get the results.`

## Canonical flow

Semantic decisions normally are:

`template → audience/data scope → output mode → preflight → correction if needed → confirm/launch → progress → result`

Do not force every decision into a separate screen. If context is already known, preserve it and skip redundant questions.

- entering from a template preselects it;
- entering from a named group preselects that audience;
- repeating a previous release may prefill safe values but must revalidate current data/template state;
- space remains visible context and is not another repeated wizard question.

## Generation summary

Before costly/immutable launch present one compact human-readable summary:

- template;
- audience: all/group/explicit selection;
- exact number of selected entities;
- output mode in user language;
- exact expected result/file count when deterministic;
- current preflight status;
- blocking problems and relevant non-blocking warnings.

Prefer a sentence users can verify, for example `27 сотрудников → 27 личных карточек`.

## One primary action by state

Each state has one dominant next action.

- incomplete selection → choose/continue;
- ready for check → `Проверить и сформировать` when the product intentionally couples check + launch;
- blocking data problems → `Исправить данные`;
- valid preflight requiring confirmation → `Сформировать`;
- running → no duplicate launch button;
- completed → `Открыть результаты` or `Скачать`;
- partial/error → `Повторить ошибки` when failed-only retry is supported.

Secondary actions must not compete visually with the next safe step.

## Preflight contract

Preflight is a real validation artifact. It answers:

- are required values available?
- is the selected template/version usable?
- is the audience non-empty and valid?
- what output will be created?
- which warnings are non-blocking?
- what exact corrections are required?

Tie preflight to a revision/fingerprint of every dependent input. If template, audience, mode or relevant data changes:

1. mark old preflight stale immediately;
2. never keep its success state silently;
3. preserve choices that remain valid;
4. rerun/require rerun according to product policy;
5. prevent launch against obsolete preflight.

## Correction without context loss

Correction is part of the same journey.

- show the entity/row/field requiring attention;
- show problematic or missing value;
- explain the required repair;
- allow safe inline correction where supported;
- preserve template, audience and mode;
- after correction, revalidate only dependent state;
- do not send the user to generic database/settings UI unless structural configuration is actually required.

Server errors during correction preserve entered values and prepared generation composition.

## Immutable launch boundary

The UI communicates that:

- the shown composition is what will be created;
- later group/data edits do not silently change an already launched release where snapshots are frozen;
- duplicate submit must not create accidental duplicate results;
- leaving the page does not cancel persisted background work.

Use confirmation only for material ambiguity/cost. Do not add a modal confirmation to every routine release.

## Running operation

Show persisted backend stage truth in human language. Communicate:

- current stage;
- completed stages;
- start/last-update time where useful;
- whether the user can leave;
- where the operation can be found later;
- safe cancel semantics if supported.

Never invent a percentage. A persisted operation must be recoverable from `Результаты` after navigation/reload.

## Partial success and retry

If valid results exist, do not label the whole operation failed.

- state succeeded vs attention counts;
- keep successful immutable results available;
- group failures by actionable cause where useful;
- offer direct correction for failed units;
- retry only failed/retryable units when supported;
- preserve idempotency so completed units are not duplicated.

The user should not reconstruct the audience merely to retry a few failures.

## Results handoff

Completion is not a dead-end toast. Show:

- what was created;
- exact result count;
- primary open/download/ZIP action;
- generation status separately from optional delivery status;
- where results remain available;
- useful secondary next actions.

Downloaded results remain in history according to product policy.

## Interaction recomposition

Before preserving clusters of template/group/mode/check/apply/refresh controls, ask:

- which values are already known from entry context?
- which are independent choices?
- which are derived metadata such as expected count?
- is `Apply`/`Refresh` present only because selectors commit incoherently?
- can validation run coherently after changes rather than requiring another technical button?

The goal is fewer unnecessary decisions, not fewer semantics.

## Motion and feedback

- selection and keyboard navigation: instant;
- validation acknowledgement: immediate;
- short tokenized transitions may clarify preflight state or inline correction reveal;
- running stages update without theatrical animation;
- success/error appears as soon as confirmed;
- never animate a primary button away without explaining the new state;
- reduced motion removes optional movement while preserving state/focus.

## Patterns

- Prefilled generation entry from template/group context.
- Compact `N objects → M files` summary.
- Stale-preflight invalidation on every dependent input change.
- Inline correction with preserved composition.
- Persisted background operation with safe navigation away.
- Failed-only retry after partial generation.
- Result handoff that stays in history.

## Anti-patterns

- Fixed seven-step wizard for every release.
- Reasking space/template/group already known from entry context.
- `Generate`, `Validate`, `Refresh`, `Apply` and `Retry` all as equal primary actions.
- Launching with obsolete preflight.
- Resetting the form after one server validation error.
- Hiding expected output count.
- Blank page while generation runs.
- Reporting whole-operation failure when most units succeeded.
- Retrying all units when only failed ones need work.
- Success toast with no path to files.
- Fake percentage or decorative progress animation.

## Acceptance scenarios

Verify:

1. template entry pre-fills template and does not ask again;
2. all/group/explicit audience produces exact human-readable expected count;
3. changing any dependent input invalidates stale preflight;
4. missing data is corrected without losing template/audience/mode;
5. server correction failure preserves entered values;
6. double-submit/idempotency does not duplicate launch;
7. navigation/reload finds persisted running operation;
8. partial success keeps valid results and retries only failed units when supported;
9. restart/retry does not duplicate completed output;
10. full flow works at 320/768/1440, 200% zoom, keyboard-only, light/dark and reduced motion.
