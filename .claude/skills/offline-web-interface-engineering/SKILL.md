---
name: offline-web-interface-engineering
description: Implement Docomator document-workstation UI in its offline local web stack with semantic HTML, shared CSS tokens, small JavaScript modules, truthful server state, CSP-safe assets, responsive reflow, keyboard access and restrained motion.
---

# Offline Web Interface Engineering

Use this skill for concrete Docomator browser UI implementation.

The repository's own `apps/api/ui/AGENTS.md`, `docs/UX_UI_SPECIFICATION.md`, `docs/BRANDING.md`, `docs/INTERFACE_HIERARCHY.md`, architecture and tests are authoritative. This skill never overrides them.

## Implementation stance

Prefer the smallest native web mechanism satisfying the interaction contract:

- semantic HTML before custom widget emulation;
- `brand-tokens.css` before new hardcoded visual values;
- existing JavaScript modules before introducing a framework;
- server/domain truth before duplicated browser state machines;
- local bundled SVG/assets before network resources;
- progressive enhancement where native controls already provide reliable keyboard/focus semantics.

Do not introduce a frontend framework merely to modernize the interface.

## Offline and CSP boundary

Runtime UI must work without Internet. Do not add CDN JavaScript/CSS, remote fonts/icons/images, analytics, runtime design-service calls or CSP-bypassing executable patterns.

Treat all document-derived text as untrusted data. Render it as text, never executable HTML, CSS, URLs, paths or code.

## Semantic controls

Use native semantics wherever possible:

- `button` for actions;
- `input`, `select`, `textarea` for ordinary forms;
- `details/summary` for simple disclosure where appropriate;
- real links for navigation;
- dialog semantics only when a decision truly blocks continuation.

For justified custom controls such as searchable selection, document-canvas selection or a complex table editor, define keyboard, focus, selected, disabled, loading and error behavior explicitly and test it.

## Shared design tokens

`brand-tokens.css` owns surface, text, accent, state colors, borders, spacing, radii, typography and motion. Do not create a parallel theme inside feature modules.

Use alignment/proximity and thin structural borders before card sprawl or elevation.

## Layout and reflow

Build for reflow, not fixed mockup dimensions.

- use Grid/Flex with `min-width: 0` where children may shrink;
- avoid global `white-space: nowrap` on buttons, labels and action rows;
- avoid fixed widths for long Russian labels without an explicit overflow contract;
- do not use absolute positioning for primary page layout;
- let action groups wrap or recompose on narrow screens;
- keep page-level horizontal overflow at zero at 320 px and 200% text zoom;
- contain horizontal scrolling inside truly two-dimensional document/table surfaces;
- account for fixed bottom navigation with safe content padding;
- long values wrap or truncate only when the full value remains discoverable.

A narrow layout is not desktop columns stacked blindly. Secondary panels may become disclosures or selected-item detail.

## Targets and density

Maintain required 44×44 CSS px interactive targets while keeping visible chrome compact. Dense registers and document tools should remain efficient without tiny hit areas or unreadable text.

## State ownership

Browser state mirrors application state; it does not invent it.

- render last confirmed server state;
- mark local/pending state explicitly when used;
- version requests or selections so stale responses cannot overwrite newer intent;
- prevent duplicate submits without hiding why;
- preserve form values after server errors;
- keep diagnostic IDs in secondary disclosure;
- never manufacture progress percentages from timers;
- restore persisted operations from backend after reload instead of in-memory timers.

## Forms and errors

Place validation near the affected field/row. User-facing error copy states what happened, whether data/input is preserved and what to do next. Raw stack traces, SQL/OOXML errors and English library messages stay out of ordinary UI.

Use existing accessibility mechanisms for important dynamic announcements. Focus the first actionable invalid field only when it does not steal focus unexpectedly.

## Motion implementation

Motion is subordinate to responsiveness.

- use project motion tokens; routine hover/focus/state transitions are short, normally about 120–160 ms under current product contract;
- never use global `transition: all`;
- avoid animating layout properties across large document/table trees;
- keyboard selection and repeated row navigation are instantaneous;
- contextual inspector/popover may use a short origin-consistent opacity/transform transition;
- no routine press-scale, bounce, page-flip, paper-flight or staggered page entrance;
- stop pending animation immediately when result is ready;
- `prefers-reduced-motion: reduce` provides a real no-motion path.

A new state wins immediately; animations never queue obsolete intent.

## Document canvas safety

A visual document representation is a projection, not an editable HTML Office model.

- render document text with safe text nodes/escaping;
- persist selection identity only as validated document coordinates;
- never serialize arbitrary DOM/CSS back into Office;
- preserve scroll/selection through inspector actions;
- recalculate any overlay geometry against the current projection revision.

## JavaScript module boundaries

Prefer feature modules with explicit responsibilities: API/domain adapter, state/render helpers, feature interaction controller, and genuinely shared primitives. Do not monkey-patch global `fetch` or browser prototypes for feature behavior; use the central session/network adapter. Avoid turning `app.js` into a monolith.

## Accessibility

Verify logical tab order, visible focus, focus restore after dialog/popover, keyboard paths for custom controls, non-color-only status, accessible names for icon-only actions, 200% reflow, dark/light/system semantics and supported high-contrast/forced-colors boundaries.

## Patterns

- Semantic HTML + tokenized CSS + small feature modules.
- Server-confirmed state with local pending overlays.
- Selection-driven inspector instead of permanent side-panel walls.
- Contained horizontal scrolling for document/table surfaces only.
- Wrapped/recomposed actions on narrow screens.
- Local inline error + preserved input.
- Local bundled icons/assets.
- Playwright/axe acceptance for real user flows.

## Anti-patterns

- Introducing React/Vue/Tailwind without an architectural need/ADR.
- Remote fonts/CDN assets.
- Clickable `div` where a button works.
- Global `nowrap`, fixed widths or `flex-shrink: 0` causing reflow failures.
- Page-level horizontal scroll because a table is wide.
- `transition: all` or 300–500 ms routine animation.
- Animated button scale, bounce, page-flip or staggered entrances.
- DOM selectors/HTML serialization as Office binding truth.
- Fake progress timers.
- Raw document text inserted as trusted HTML.
- Browser state diverging from persisted operation state.

## Acceptance

For material UI changes run repository-native checks and exercise the real flow, including as applicable:

1. syntax/static/canonical UI/CSP checks;
2. user-facing language checks;
3. 320/768/1440 browser flow;
4. 200% text zoom with no page-level horizontal overflow;
5. keyboard-only path and focus return;
6. light/dark/system and reduced motion;
7. slow/failing API behavior with preserved input/context;
8. stale-response race after rapid selection change;
9. Playwright/axe and real-stack document flow;
10. runtime network inspection confirming no external asset dependency.
