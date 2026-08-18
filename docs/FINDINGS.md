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
| Object ID | InDesign ID for the resolved page item or text frame when available |
| Object type | InDesign object class used for targeting |
| Link/file name | Placed asset name when the target resolves to a linked graphic or Link |
| Frame label/name | Script label and/or frame name when available |
| Geometric bounds | Resolved page-item bounds in InDesign `[y1, x1, y2, x2]` order |
| Story/frame ID | Story and text-frame identifiers when the target belongs to text |
| Title | Short statement of the condition |
| Detail | Why the condition deserves review |
| Target | Live InDesign object used by Locate when available |
| Action | Optional guarded remediation |

## Severity rules

### ERROR

A condition with a strong likelihood of omitted content, unresolved assets, unavailable resources, or failed output. Errors should normally be resolved before production output.

Current examples: overset text, missing links, inaccessible URL links, and unavailable fonts used by live text.

### WARNING

A condition that can produce degraded, incomplete, inaccessible, or unintended output depending on production intent. Warnings require review before output.

Current examples: out-of-date links, low effective bitmap resolution, missing EPUB alternate text, missing table header rows, missing EPUB title metadata, same-page hyperlink source text with multiple destinations, and suspicious trailing URL punctuation.

### INFO

A condition that deserves explicit verification but can be valid by design.

Current examples: unavailable font references with no detected live text use, unanchored EPUB graphics, no Articles panel reading order, missing author metadata, and HTTP hyperlinks that deserve HTTPS review.

## Scope rules

### Document

Used for findings that apply before output format is selected or can affect more than one output path.

### Print/PDF

Used for findings tied to page fidelity or print-oriented production characteristics.

### EPUB

Used for semantic, reading-order, accessibility, metadata, and reflow concerns that need review before EPUB export.

## Location policy

DocStats resolves a page from the affected InDesign object when the DOM exposes one. The Locate command activates that page and selects the page item when possible.

Some document resources, especially metadata and unused font references, do not expose a single page. Those findings use `Document` as the location.

Unavailable-font checks use two stages. `DOC-006A` identifies an unavailable font applied to live text and targets the first detected text-style range. `DOC-006B` identifies an unavailable font reference for which no live text-style range was found and remains document-wide.

## Automated-action policy

An automated action qualifies for DocStats when all of the following are true:

1. The affected object is unambiguous.
2. The action has a narrow and predictable effect.
3. Required replacement content comes directly from the operator or an existing source file.
4. The action does not silently recompose or restructure broad portions of the document.
5. The operator explicitly invokes the action.

This policy allows link updates, explicit relinking, alternate-text entry, metadata entry, and confirmed table-header designation. Hyperlink anomaly findings currently remain review-only because destination correction can change publication semantics.

Broad layout repair, font substitution, automatic anchoring, automatic reading-order construction, and export-setting rewrites remain manual until a safer decision model exists.

## Stable codes

Finding codes are grouped by finding family:

- `DOC-nnn` for document-wide production health
- `HYP-nnn` for hyperlink integrity and review signals
- `PRINT-nnn` for Print/PDF production checks
- `EPUB-nnn` for EPUB checks

Codes should remain stable once published. A check that changes meaning substantially should receive a new code rather than silently repurposing an existing one. Letter suffixes can identify related stages of one check family, as with `DOC-006A` and `DOC-006B`.

## Hyperlink finding family

Hyperlink findings use the `HYP-nnn` family while retaining `DOCUMENT` as their current scope because the same hyperlink source can affect interactive PDF and EPUB output.

| Code | Severity | Condition |
|---|---|---|
| HYP-001 | WARNING | Identical source text on the same page resolves to more than one destination |
| HYP-002 | INFO | External destination uses the HTTP scheme |
| HYP-003 | WARNING | HTTP, HTTPS, or FTP destination ends with punctuation likely to have been captured from surrounding prose |

`HYP-001` is grouped by page plus normalized source text so repeated labels on different pages do not create a conflict by themselves. `HYP-002` does not assume that an HTTPS endpoint exists. `HYP-003` identifies review candidates and does not rewrite the destination automatically.
