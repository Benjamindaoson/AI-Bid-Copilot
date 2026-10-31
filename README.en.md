# Bid Agent (投标智能体)

**Trace each bid response to evidence. Let people approve each change.**

Bid Agent is a local desktop workspace for tender requirements, company evidence, technical documents, chapter drafts, and human review. It uses Electron, React, TypeScript, and Word document processing. The product name shown in the application is 投标智能体.

## Project characteristics

1. **Requirements before prose.** Import a tender to build an editable requirements list, then compare it with company materials in a response matrix. Chinese mandatory terms such as “必须”, “应当”, “不得”, “至少”, and “不超过” have dedicated rules. Clear numeric and date thresholds are checked by local code. Missing evidence stays pending.
2. **Evidence beside conclusions.** Findings retain available source text and file, paragraph, line, or table locations. The construction audit distinguishes definite conflicts, possible differences, insufficient evidence, and no issue. Different statistical scopes are not automatically treated as errors.
3. **Local DOCX review and focused revision.** The construction workflow reads document structure and tables, exports an audit report, and lets a user stage and approve a local paragraph edit before exporting a revised copy. Complex Word elements are flagged for review in Word.
4. **Chapter-level human control.** The new-project workspace builds chapter drafts from requirements, permits editing, confirmation, and revocation, and invalidates decisions when sources change. A chapter without adequate tender and company citations cannot be confirmed.
5. **Bring your own model.** Settings → AI Models accepts custom OpenAI-compatible endpoints and manually entered model IDs, including compatible local services. Text and image models are configured separately. The application service layer manages requests and uses Electron secure storage for keys when available. Real client content stays local unless the user authorizes a specific external destination.

## Two main workflows

| Use case | Steps | Result |
| --- | --- | --- |
| Review an existing construction proposal | Import DOCX → inspect structure → run local audit → review evidence → record a decision → revise a passage → export Word | Located findings, human decisions, an audit report, and a revised copy |
| Prepare a new bid | Import tender and company materials → review requirements → inspect response matrix → prepare chapter drafts → review risks → export Word | Evidence-linked working material and a verification report |

The second workflow creates a **reviewable working draft**, not a submission-ready proposal. Qualifications, drawings, prices, schedules, and commitments still require original documents and professional sign-off. The technical-plan module also provides tender analysis, outline planning, global facts, content editing, and Word export; individual entry points have different levels of maturity.

## Available workflows

- Import tender and company documents to build an editable requirements list and response matrix. Missing evidence remains marked for review.
- Compare clear numeric and date thresholds with deterministic rules and retain source locations.
- Create separate chapter drafts from the requirements, edit them, confirm or revoke each chapter, and prevent confirmation when source citations are removed.
- Parse an existing construction proposal locally, review supported findings, revise a selected passage, and export Word files.
- Configure your own model provider under Settings → AI Models, including custom OpenAI-compatible endpoints and model IDs.

## Limits

Chapter drafts are working material, not a submission-ready proposal. A person must verify qualifications, quantities, prices, schedules, and commitments. The application cannot verify missing tender documents, drawings, or company records. Do not commit client documents to this repository. Confirm the destination and authorization before using an external model with real business material.

The repository includes synthetic fixtures and targeted tests for requirement coverage, citations, model configuration, and service behavior. Small synthetic test results are not a general accuracy guarantee. Real third-party model performance has not been broadly validated without user-provided credentials and permission to transmit business data. Some historical compatibility fields and independent licensing mechanisms remain; their handling must preserve user data and lawful access. The application does not infer evaluation scores or certify final bid compliance.

## Development

The Windows development baseline is Node.js 22. From the client directory:

    npm ci
    npm run build
    npm run dev

The application lives in client/. Electron Main and Preload handle local services and file operations; React and TypeScript provide the interface. Personal settings, API keys, client files, and exports must stay out of Git.

Focused checks from client/:

    node scripts/evaluate-construction-coverage.cjs
    node --test electron/services/manufacturingWorkbench.test.cjs electron/services/modelProviderStore.test.cjs
    npm run smoke:electron-native

The test fixtures in client/scripts/fixtures/ are synthetic. The real FengTai case document is not included in this repository.

## License and attribution

Third-party source and author attribution are preserved in [NOTICE](./NOTICE). Usage and redistribution terms are in [LICENSE](./LICENSE) (AGPL-3.0-only).

[简体中文](./README.md)
