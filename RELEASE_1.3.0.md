# Project Octopus 1.3.0 — Project Intelligence

Release date: 26.08.2026

## Scope

1. **Document AI Processing Center** — a visible state machine from upload through extraction, Gemini analysis, recognition, project assignment and module publication; with explanations, errors and retry.
2. **ZIP/folder package jobs** — package-level totals, completed items, exceptions, failures and pending children.
3. **AI confidence exceptions** — low-confidence items (<70%) are explicitly surfaced as requiring a human decision rather than being silently trusted.
4. **Full provenance** — durable entity-to-source links with document, version/revision, page/section/locator and source excerpt.
5. **Document Control revisions** — revision-family detection, candidate linking, previous version relations and revision status.
6. **Automatic change impact** — changes are mapped to BOQ, material requests, warehouse/WZ, schedule, protocols, tasks, finance and documentation.
7. **BOQ ↔ reality** — quantity reconciliation across budget, purchase orders, warehouse issues, installed/accepted progress and invoicing, including automatic overrun flags.
8. **Material-request workflow** — AI detects materials without a request, can create a real reviewable draft, and follows the request through sent/approved/ordered/delivered stages using existing procurement traces.
9. **Octopus Brain 2.0** — latest facts, durable fact history, conflicts and exact source/revision context.
10. **Project Intelligence: “Co powinienem zrobić dzisiaj?”** — prioritized investment actions generated from processing failures, AI review needs, revision impacts, BOQ overruns, missing material requests, overdue tasks and missing documents.

## Safety and governance

- AI confidence is visible and low-confidence exceptions are routed to review.
- AI-created material requests are drafts and explicitly require human review before sending/approval.
- No measurement, inspection, test, acceptance result or signature is invented by this release.
- Existing authorization/domain checks remain in front of investment data and write actions.

## Data layer

Migrations:
- `20260826090000_project_intelligence_130.sql`
- `20260826091000_project_intelligence_130_provenance_events.sql`
- `20260826092000_project_intelligence_130_provenance_trigger_fix.sql`

The migrations are additive and build on existing Project Octopus document processing, AI Review Center, Revision/Change Control, BOQ/WBS, procurement, warehouse, progress and finance models instead of duplicating those systems.
