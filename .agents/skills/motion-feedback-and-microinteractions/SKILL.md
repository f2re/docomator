---
name: motion-feedback-and-microinteractions
description: Docomator-specific motion and micro-feedback rules: purposeful, fast, interruptible, reduced-motion-safe and subordinate to document selection, validation, generation and recovery state.
---

# Motion, Feedback and Microinteractions

Before animating, state what information movement communicates that an immediate static state change would not.

## Frequency rule

The more often an action occurs, the less motion it gets.

Instant or nearly instant:

- keyboard field/row/cell/list navigation;
- document-region selection highlight;
- search result movement;
- text editing;
- repeated preview selection;
- drag/reorder preview.

Motion must never add latency to these actions.

## Duration family

Use project tokens rather than arbitrary values.

- `instant`: 0–60 ms for selection/high-frequency actions;
- `micro`: about 80–120 ms for small hover/focus acknowledgement;
- `fast`: about 120–160/180 ms for popover/inspector/state swap;
- `standard`: at most about 160–240 ms for an infrequent small panel/dialog transition when spatial continuity genuinely helps.

Routine Docomator transitions should remain near the existing 120–160 ms product contract. Avoid >240 ms for ordinary work.

## Allowed purposes

Motion may communicate:

- action acknowledgement;
- origin/continuity of a contextual inspector or disclosure;
- pending → confirmed/error state change;
- deterministic drag/drop/reorder target feedback;
- rare focus on an important change.

A ready result appears immediately. Never wait for a spinner cycle or exit animation.

## Document-workstation mapping

Prefer:

- instant document text/cell/row highlight;
- short origin-consistent inspector/popover reveal;
- subtle pending → validated/error transition;
- local repair-detail disclosure;
- immediate generation/import stage-state changes;
- restrained static/short file-drop and row-reorder feedback.

Avoid:

- page-flip/paper-flight metaphors;
- animated document thumbnails as loading indicators;
- pulsing template fields;
- routine press-scale/bounce;
- animating pagination/table geometry/text reflow after binding;
- delayed result/download availability;
- staggered list/result entrances.

Motion must never obscure whether preview/preflight is current or stale.

## Interruptibility

Latest user intent wins immediately. Rapid toggles/selections converge on the current state; animations are not queued. Closing/reopening an inspector rapidly must not leave it in an intermediate state.

## Web implementation

- prefer opacity/transform for small overlay continuity;
- avoid width/height/top/left animation across large document/table trees;
- never use global `transition: all`;
- state text and focus update independently of animation completion;
- spinner/pending animation stops as soon as backend result is ready;
- preserve scroll and logical selection through transitions.

## Reduced motion

`prefers-reduced-motion: reduce` removes nonessential spatial movement rather than merely shortening it. State, focus, selection and pending/error/success meaning remain visible immediately.

## Loading

Loading motion represents real pending work. Prefer human stage text for multi-stage document operations. Never invent progress percentages from elapsed time.

When safe, keep previous valid content visible and mark the new target pending. If a short crossfade is used, stale/current state remains explicit.

## Patterns

- Instant selection + subtle inspector continuity.
- Pending → confirmed/error without delaying result.
- Short disclosure transition for infrequent repair details.
- Static drag target + deterministic drop result.

## Anti-patterns

- Animate everything because CSS supports it.
- 300–500 ms menus/dropdowns.
- Animation on keyboard highlight.
- `transition: all`.
- Non-interruptible panel motion.
- Motion as the only selection/error cue.
- Page-flip, paper-flight, bounce or pulsing in routine document work.
- Delaying a ready result for animation.
- Staggering every row in a result/import list.

## Acceptance

Trigger the same action faster than its transition duration; UI must stay responsive and converge on latest intent. Verify reduced motion. Repeatedly select/bind/repair/retry while scrolling and confirm that motion never loses focus/selection, shifts the wrong target or delays confirmed state.
