---
name: skill-agent-orchestrator
description: Project-local skill/agent orchestrator for Оформлятор that routes document UI work to the smallest relevant skills and existing project agents without creating parallel library roles.
---

# Skill and Agent Orchestrator for Оформлятор

Use this for multi-area document UI work. It routes and synthesizes; `ui-skill-router` owns detailed skill selection.

Do not preload all skills or spawn all agents.

## Project authority

Before delegation read the applicable root/scoped `AGENTS.md`, requirements, accepted ADRs, architecture, UX specification, branding/interface hierarchy and current implementation/tests. Project-local authority overrides reusable skill guidance.

## Existing agents are the roles

Do not install parallel library agents. Use the existing project profiles:

| Workstream | Existing agent |
|---|---|
| Information architecture, flow, language, usability, anti-slop concept | `product_designer` |
| Offline HTML/CSS/JS implementation, responsive/accessibility/browser tests | `frontend_engineer` |
| Document IR, DOCX/XLSX selection/binding/render/extraction boundary | `document_engineer` |
| Unit/E2E/recovery/accessibility/regression coverage | `test_engineer` |
| Space/security/untrusted document review | `security_reviewer` |
| Architecture/domain-boundary conflicts | `architecture_guardian` |

The parent agent owns integration and final validation.

## Routing

1. Classify the primary user job and work object.
2. Use `ui-skill-router` to choose the smallest skill set.
3. For a substantial primary-surface/IA redesign, settle `anti-slop-ui-direction` before implementation delegation.
4. Delegate only independent bounded workstreams.
5. Avoid concurrent write-heavy agents in overlapping files.
6. Run `ui-audit-and-acceptance` after material implementation.

## Typical compositions

### Visual template studio

- skills: `document-template-canvas-and-binding` + `offline-web-interface-engineering`;
- agents: `product_designer` for interaction contract, `document_engineer` for Document IR/binding truth, `frontend_engineer` for implementation; `test_engineer` for acceptance.

### Generation flow

- skills: `document-generation-flow` + `document-workstation-ux` + `offline-web-interface-engineering`;
- agents: `product_designer` + `frontend_engineer`; add backend/test/security only when the change crosses their boundaries.

### Extraction/import review

- skills: `document-extraction-and-import-review` + `offline-web-interface-engineering`; add template-canvas skill only for source-linked document selection;
- agents: `document_engineer`, `product_designer`, `frontend_engineer`, `test_engineer`; security review for untrusted-input/space boundary changes.

### Local UI fix

Work directly or use one relevant agent. Do not invoke anti-slop or a multi-agent ceremony for a label, spacing, focus or isolated state bug whose interaction model is settled.

## Parent integration contract

After delegation:

- deduplicate findings;
- resolve conflicts against project authority;
- preserve deterministic renderer, space isolation, immutable source/result and explicit mutation boundaries;
- preserve any accepted Design Direction Contract unless evidence reopens it;
- produce one coherent implementation rather than concatenated reports;
- run repository-native tests and inspect exact GitHub CI head before completion.

## Anti-patterns

- Installing another UI designer/frontend/document agent from the reusable library.
- Loading all skills “just in case”.
- Letting a visual proposal weaken Document IR, space or renderer invariants.
- Delegating overlapping writes to several agents.
- Treating five specialist reports as the final design.
- Invoking macro anti-slop for a local one-control fix.
