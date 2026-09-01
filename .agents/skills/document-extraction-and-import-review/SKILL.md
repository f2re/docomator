---
name: document-extraction-and-import-review
description: Design automatic-first DOCX/XLSX extraction and structured import review so users of Оформлятор see a proposed interpretation, correct only ambiguity, repair row/cell problems in place and explicitly commit data without re-uploading files.
---

# Document Extraction and Import Review

Use this skill for document/data intake where Оформлятор analyzes DOCX/XLSX, proposes structured datasets and may later import confirmed values into application storage.

The primary interaction model is automatic first, correction second.

The user wants to give the system a document, see what it understood, correct mistakes, then use or import the structured result. They should not need to understand Document IR, workbook XML, source SHA, storage row indexes or property keys.

## Canonical flow

`file/drop → automatic analysis → proposed structure/result → focused review → corrections → explicit import/export/use`

For ordinary CSV/XLSX typed import preserve the semantic sequence when needed:

`file → columns → mapping → preview → repair → import → result`

Automatic analysis should prefill as much mapping/review as evidence allows while keeping uncertainty visible.

## File entry

Provide both a visible file picker and drag-and-drop on a clearly labeled target.

- show supported formats and limits before upload;
- identify the file being analyzed;
- duplicate/unsupported/corrupt files get specific states;
- preserve selected file and configuration after recoverable errors;
- never require re-upload merely to fix mappings or cell-level problems.

## Automatic proposal

Show what the system found rather than another blank setup form.

Useful human states:

- `Готово` — structurally clear;
- `Нужно проверить` — ambiguity needs a decision;
- `Не определено` — a required relationship cannot be inferred safely.

Do not show confidence percentages unless they change the user's action.

For proposed datasets/fields expose human name, inferred type, representative values, useful source context, supported structural kind and problems requiring a decision.

The automatic result is immutable evidence. User corrections are a separate layer and must not rewrite the original detection.

## Source-linked review

When possible, connect structured result to source paragraph/cell/row using validated document coordinates or bounded source context.

- selecting a proposed field highlights the source region;
- selecting a source row highlights the extracted record;
- an error row exposes raw value and exact source column/cell;
- batch navigation moves to the next unresolved problem without losing scroll/context.

Never persist browser DOM selectors as source identity.

## Corrections

Support only corrections that map to safe domain contracts, for example:

- rename a proposed field label;
- change an inferred supported type;
- exclude a field/region;
- classify scalar vs repeat/table where supported;
- map to an existing property in the current space;
- correct a preview value where policy permits;
- explicitly create a new property through a guided mutation.

Corrections remain reversible until explicit import/use commit. Never silently create global or user fields because a column name is unfamiliar.

## Structured errors

Error semantics originate machine-readable in domain/API and are then rendered in Russian.

A useful problem contract contains:

- stable `code`;
- scope/blocking effect;
- physical source row;
- source column/cell or target property when known;
- raw problematic value;
- severity;
- suggested action;
- repair parameters.

UI copy answers:

1. what is wrong;
2. where it is wrong;
3. whether other data remains usable;
4. what exact action fixes it.

Never recover row/field semantics by regexp parsing localized error text.

## Preview repair

Prefer repairing simple issues directly in preview:

- highlight affected row/cell/value;
- focus the actual field needing correction;
- preserve mappings and other repaired rows;
- validate locally where safe, then confirm with server;
- keep valid rows visible while a subset has errors;
- make partial-import policy explicit.

Blank imported values follow product policy. A blank cell does not erase confirmed stored data without an explicit clear operation.

## Space boundary

Automatic suggestions and remembered mappings are scoped to the current space.

- match only property definitions from current space;
- identical names/keys in another space must not leak into suggestions;
- preview/read never claims ownership or creates property definitions;
- explicit import mutation receives current `spaceId`;
- cross-space links are rejected before commit.

Minimal UI must not hide the current space when it changes mapping meaning.

## Explicit commit boundary

Analysis, preview and correction are not import.

Use a clear action such as `Импортировать`/`Применить` and state what will change. Before commit summarize source, valid row count, unresolved blockers, target context, partial-import behavior and any explicitly approved field creation.

After commit show counts and next actions, not a generic success toast.

## Batch documents

For multiple documents show one compact row/status per file with aggregate summary. Users can see which files are ready/review/failed, jump to next unresolved file, apply truly equivalent batch corrections, keep completed files untouched and distinguish duplicates according to product policy.

Avoid a giant card per file.

## Responsive table behavior

A table may scroll in two dimensions; the page should not.

At narrow widths contain horizontal scrolling inside the explicit preview/table surface, keep current problem/action reachable, preserve row identity/status, use selected-row stacked detail when clearer, and maintain 44×44 targets and visible focus. Test 200% text zoom separately.

## Motion and feedback

- selecting rows/source regions: instant;
- drag/drop acceptance: immediate restrained feedback;
- selected-row repair detail may use a short interruptible transition;
- error highlighting never flashes repeatedly;
- progress uses real stages/status, never fake percentages;
- large batch updates do not animate rows one by one;
- reduced motion removes nonessential spatial transitions.

## Patterns

- Automatic proposal immediately after analysis.
- Source-linked result review.
- Immutable automatic result + separate correction layer.
- Structured row/cell errors with direct repair.
- Mapping preserved after server failure.
- Explicit import commit after preview.
- Current-space field suggestions only.
- Batch register ordered by unresolved attention.

## Anti-patterns

- Empty manual mapping grid when a reliable proposal exists.
- Confidence scores with no actionable effect.
- Parsing Russian messages to recover row/column/error codes.
- Resetting file/mapping/corrections after one invalid row.
- Re-upload required after preview correction.
- Creating a property because a header was unknown.
- Blank cells as implicit destructive clears.
- Persisting DOM selectors as source coordinates.
- Page-level horizontal overflow caused by preview table.
- One modal per invalid row.
- Decorative progress animation.

## Acceptance scenarios

Verify at minimum:

1. DOCX key/value + table extraction produces automatic proposal without manual setup;
2. XLSX blank cells, mixed types, Excel dates, embedded newlines and duplicate/blank headers preserve physical coordinates;
3. renamed/reordered/missing structure becomes explicit problem, never silent shift;
4. source and result selection stay visually linked where supported;
5. correction survives server error;
6. preview repair does not require re-upload;
7. explicit import uses only current-space fields and negative two-space tests pass;
8. repeat import is idempotent and blank values do not silently erase confirmed data;
9. batch 1/10/100 files exposes individual status without card sprawl;
10. 320/768/1440, 200% zoom, keyboard/focus, light/dark, reduced motion and no page-level horizontal overflow pass.
