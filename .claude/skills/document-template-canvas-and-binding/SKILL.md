---
name: document-template-canvas-and-binding
description: Design Оформлятор's visual DOCX/XLSX template workbench where users select real document regions, bind human-readable fields and repeats, preview safely and preserve Office structure without making browser DOM the source of truth.
---

# Document Template Canvas and Binding

Use this skill for Visual Template Studio: DOCX/XLSX preview, field selection, binding, repeat-row setup, trial rendering and activation.

The primary job is:

`The user points at a place in the document and tells the system what data belongs there.`

Everything else supports that job without exposing OOXML implementation details.

## Source-of-truth boundary

The visual canvas is a bounded read-only projection of an immutable source document.

Hard rules:

- browser DOM, CSS selectors, rendered pixel coordinates and client HTML are never the authoritative binding contract;
- selection commits only server-validated Document IR coordinates such as stable element IDs + offsets, cell/range addresses or another project-approved coordinate;
- the renderer patches only allowed deterministic bindings;
- untouched Office structure, styles, tables, headers/footers, formulas and declared supported constructions remain preserved;
- visual approximation discloses unsupported or uncertain layout instead of pretending fidelity;
- LLM suggestions may propose bounded candidate IDs but never author arbitrary OOXML, paths, code or executable expressions.

## Work surface

The document itself dominates the editor.

Wide-screen hierarchy:

1. compact document/context header;
2. large scrollable document/template canvas;
3. contextual inspector for the current selection;
4. compact local progress/readiness state.

The inspector is selection-driven. It must not permanently consume a large part of the canvas when nothing is selected.

On narrow screens preserve the same conceptual order. The inspector may move below the canvas or into a disclosure surface. Page-level horizontal overflow is forbidden; two-dimensional scrolling is contained inside the document/table surface only where necessary.

## Selection model

Support only selection kinds the backend can validate and render safely, for example:

- text/span;
- paragraph/block;
- DOCX table cell or row;
- XLSX cell/range;
- explicit repeatable row/block;
- supported header/footer element when the Document IR exposes it safely.

For each selection show:

- what exactly is selected in human terms;
- a visible non-color-only highlight;
- current binding, if any;
- scalar vs repeatable meaning;
- limitations that affect the final document.

Avoid tiny handles and hover-only affordances. Click selects; drag extends selection only where semantics are obvious. Provide keyboard navigation between selectable elements and a keyboard path to the inspector.

## Binding flow

Prefer:

`select document region → choose data field/action → preview meaning → commit binding`

The field chooser:

- shows Russian/human labels first;
- searches labels and aliases;
- groups fields by useful user context rather than storage tables;
- shows type/scope only as secondary disambiguation;
- never requires machine keys, UUIDs or OOXML coordinates;
- preserves the current document selection while open.

After commit, canvas and inspector update from confirmed server state. If commit fails, preserve selection and pending choice so the user can repair or retry.

## Existing text and replacement meaning

Make the replacement contract explicit:

- what source text/cell is the binding target;
- whether surrounding formatting is preserved;
- whether visible content is example text, fixed text or generated value;
- whether trial rendering is required before activation.

Do not make the user reason about runs, XML tags or content-control internals.

## Repeat rows and collections

For a repeatable table row/block use a domain action such as `Повторять эту строку по списку`.

Then guide the user through:

1. choose the repeated collection/source by human name;
2. map cells/places to fields in that collection;
3. optionally assign a supported virtual value such as automatic row numbering;
4. show an example with N rows or a bounded preview dataset;
5. state empty-list behavior;
6. run trial/reverse-read validation before activation.

Visually distinguish repeat zones from scalar bindings without relying on color alone. Do not leave a fake sample row when the empty-list contract requires zero rows. Never expose nested repeat UI ahead of renderer support.

## Selection-driven inspector

Recommended order:

1. selected place/row/range;
2. current binding or `Не назначено`;
3. primary action: assign/change field or configure repeat;
4. validation/problem message;
5. trial value/preview;
6. supported secondary options;
7. technical details in explicit disclosure.

Do not display every template field, coordinate and diagnostic property permanently beside the document.

## Async layout and stale state

Visual layout, preview and trial rendering may be asynchronous.

- version requests by source/template revision;
- cancel or ignore stale completions;
- keep the current usable canvas visible while a replacement is pending when safe;
- preserve the selected logical element if it still exists in the new revision;
- if the selection no longer exists, explain that the document changed and require a new selection;
- never silently bind a stale coordinate to a changed document.

## Direct manipulation

Use direct manipulation only when it maps to document semantics:

- drag to extend a text/range selection;
- select a whole table row with a clear row affordance;
- reorder data rows in the data editor, not immutable template structure unless explicitly supported.

Pointer interaction is preview; binding commit is explicit. Use an activation threshold so a normal click does not become an accidental drag. Every core gesture has a keyboard/button alternative.

## Motion and feedback

- selection highlight: instant;
- keyboard traversal: instant;
- inspector open/close: short and interruptible only when motion improves orientation;
- binding success: immediate confirmed state;
- errors appear at the selected object/inspector; no shake or bounce;
- never animate pagination, table geometry or text reflow merely for polish;
- reduced-motion keeps all state understandable without spatial animation.

## Patterns

- Document canvas + contextual inspector.
- Human field search instead of machine-key picker.
- Explicit scalar vs repeat semantics.
- Selection retained through validation errors.
- Trial render before activation.
- Honest limitation disclosure.
- Server-confirmed binding shown back on the exact logical region.

## Anti-patterns

- Persisting browser DOM selectors or pixel rectangles as Office identity.
- Re-serializing visual HTML/CSS back into DOCX/XLSX.
- Permanent multi-column inspector walls that shrink the document to a thumbnail.
- Requiring OOXML paths, UUIDs or field keys.
- Hover-only field assignment.
- Drag-only repeat setup.
- Pretending unsupported Word/Excel layout is faithfully rendered.
- Allowing stale visual layout to commit a binding after the source changed.
- Adding formatting controls the deterministic renderer cannot preserve or validate.
- Decorative WYSIWYG animations that cause layout movement or selection loss.

## Acceptance scenarios

Verify at least:

1. bind a formatted DOCX text span without losing surrounding formatting;
2. bind an XLSX cell/range with empty neighboring cells and no coordinate shift;
3. configure a supported repeat row and automatic numbering;
4. change a field after failed server commit without reselecting the region;
5. refresh visual layout while preserving valid selection and rejecting stale completion;
6. use the main binding path with keyboard only;
7. inspect claimed headers/footers/tables/styles/images with honest limitations;
8. run trial + structural/reverse-read validation before activation;
9. verify 320/768/1440, 200% zoom, dark/light, reduced motion and no page-level horizontal overflow.
