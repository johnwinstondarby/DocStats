# DocStats findings model

DocStats findings are designed for remediation. A useful finding identifies the condition, its priority, its output scope, and a location that an operator can reach.

## Finding fields

Every finding records:

| Field | Purpose |
|---|---|
| Severity | Operational priority: ERROR, WARNING, or INFO |
| Scope | Document, Print/PDF, or EPUB |
| Code | Stable identifier for reporting and future suppression rules |
| Page | InDesign page name when a page can be resolved |
| Location | Human-readable location, normally a page or Document |
| Title | Short statement of the condition |
| Detail | Why the condition deserves review |
| Target | Live InDesign object used by Locate when available |
| Action | Optional guarded remediation |

## Severity rules

### ERROR

A condition with a strong likelihood of omitted content, unresolved assets, unavailable resources, or failed output. Errors should normally be resolved before production output.

Current examples: overset text, missing links, inaccessible URL links, unavailable fonts.

### WARNING

A condition that can produce degraded, incomplete, inaccessible, or unintended output depending on production intent. Warnings require review before output.

Current examples: out-of-date links, low effective bitmap resolution, missing EPUB alternate text, missing table header rows, missing EPUB title metadata.

### INFO

A condition that deserves explicit verification but can be valid by design.

Current examples: unanchored EPUB graphics, no Articles panel reading order, missing author metadata.

## Scope rules

### Document

Used for findings that apply before output format is selected or can affect more than one output path.

### Print/PDF

Used for findings tied to page fidelity or print-oriented production characteristics.

### EPUB

Used for semantic, reading-order, accessibility, metadata, and reflow concerns that need review before EPUB export.

## Location policy

DocStats resolves a page from the affected InDesign object when the DOM exposes one. The Locate command activates that page and selects the page item when possible.

Some document resources, especially font objects and metadata, do not expose a single page. Those findings use `Document` as the location.

A later release can add finer text-range location for document-wide resources where InDesign find operations can resolve individual occurrences without excessive scan cost.

## Automated-action policy

An automated action qualifies for DocStats when all of the following are true:

1. The affected object is unambiguous.
2. The action has a narrow and predictable effect.
3. Required replacement content comes directly from the operator or an existing source file.
4. The action does not silently recompose or restructure broad portions of the document.
5. The operator explicitly invokes the action.

This policy allows link updates, explicit relinking, alternate-text entry, metadata entry, and confirmed table-header designation.

Broad layout repair, font substitution, automatic anchoring, automatic reading-order construction, and export-setting rewrites remain manual until a safer decision model exists.

## Stable codes

Finding codes are grouped by scope:

- `DOC-nnn`
- `PRINT-nnn`
- `EPUB-nnn`

Codes should remain stable once published. A check that changes meaning substantially should receive a new code rather than silently repurposing an existing one.
