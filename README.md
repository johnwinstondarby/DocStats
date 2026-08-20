# DocStats

DocStats is an Adobe InDesign document statistics, health, and output-readiness scanner. It is designed to help an operator answer two questions before export:

1. What is in this document?
2. Which findings need attention, where are they, and what can be done next?

The current implementation is an ExtendScript (`.jsx`) script for Adobe InDesign.

## Safety posture

**MODIFIES ON EXPLICIT SELECTION.**

Scanning is read-only. DocStats never changes the document during a scan.

Five guarded actions can modify the document, and only when the operator
selects a finding and invokes the action:

- update an out-of-date link
- relink a missing asset to a file the operator chooses
- write EPUB alternate text the operator enters
- designate the first row of a table as a header row, after confirmation
- write document title or author metadata the operator enters

DocStats does not silently change layout, resize frames, substitute fonts,
anchor objects, alter reading order, or rewrite export settings.

Actions are not currently grouped for undo, and there is no automatic
rollback. Work on a copy of any document you value.

## Current release

**v1.1.0**

DocStats scans the active InDesign document and presents findings in a persistent palette. Scanning is read-only. A small set of guarded actions can modify the document only after the operator explicitly selects the action.

## Three scopes

DocStats separates findings into three operational scopes:

- **Document**: conditions that can affect any output, including overset text, missing or stale links, inaccessible links, and unavailable fonts.
- **Print/PDF**: layout and production conditions specific to print-oriented output. The first check is effective bitmap resolution.
- **EPUB**: pre-export checks for alternate text, anchored graphics, table headers, document metadata, and Articles panel reading-order review.

The **All** view combines the three scopes without changing the finding's assigned scope.

## Findings model

Each finding carries:

- severity: `ERROR`, `WARNING`, or `INFO`
- scope
- stable finding code
- page number when InDesign exposes one
- location label
- object ID
- object type
- link/file name when applicable
- frame label/name when applicable
- geometric bounds when available
- story/frame ID when applicable
- finding title and detail
- target object when available
- optional guarded action

The **Locate** button pages to the affected location and selects the object when InDesign exposes a selectable target. This makes the report useful for remediation rather than producing a detached list of warnings.

## Included checks

### Document

| Code | Severity | Finding | Action |
|---|---|---|---|
| DOC-001 | ERROR | Overset text | Locate |
| DOC-002 | ERROR | Missing linked asset | Relink |
| DOC-003 | WARNING | Out-of-date linked asset | Update link |
| DOC-004 | ERROR | Inaccessible URL link | Locate |
| DOC-005 | INFO | Unrecognized link status | Locate |
| DOC-006A | ERROR | Unavailable font used by live text | Locate first detected live use |
| DOC-006B | INFO | Unavailable font referenced but no live text use found | Manual review |
| DOC-007 | WARNING | Document has no pages | Manual review |
| HYP-001 | WARNING | Same hyperlink source text on one page has multiple destinations | Locate and review |
| HYP-002 | INFO | Hyperlink uses HTTP rather than HTTPS | Locate and review |
| HYP-003 | WARNING | URL ends with suspicious trailing punctuation | Locate and review |

### Print/PDF

| Code | Severity | Finding | Action |
|---|---|---|---|
| PRINT-001 | WARNING | Bitmap below advisory effective-PPI threshold | Locate |

Effective-PPI checks use an output-readiness profile rather than a single hard-coded threshold:

- **General Health**: 200 PPI advisory threshold
- **Print Production**: 300 PPI advisory threshold
- **EPUB**: print effective-PPI check disabled

The values are operational defaults defined in `PROFILES` near the top of `DocStats.jsx`. Required resolution depends on output process, line screen, source content, and viewing distance.

### EPUB

| Code | Severity | Finding | Action |
|---|---|---|---|
| EPUB-001 | WARNING | Graphic has no resolved alternate text | Set custom alt text |
| EPUB-002 | INFO | Graphic is not anchored in text | Locate and review |
| EPUB-003 | INFO | No Articles panel reading order is defined | Manual review |
| EPUB-004 | WARNING | Table has no header row | Set first row as header |
| EPUB-005 | WARNING | Document title metadata is empty | Set title |
| EPUB-006 | INFO | Document author metadata is empty | Set author |

EPUB findings are pre-export review signals. A decorative image, fixed-layout EPUB, or intentionally layout-driven reading order can make a flagged condition acceptable.

## Hyperlink analysis

DocStats classifies InDesign hyperlinks separately from placed-file link status. Each hyperlink record carries direction, destination category, scheme, normalized domain, source form, page, source text or graphic, destination, repetition status, destination occurrence count, and the standard object-location fields.

Top-level direction categories are:

- **Internal**: page, text, paragraph, and fragment destinations
- **External**: web URL, email, telephone, file URL, FTP, other URL, and external-document page destinations
- **Unknown**: destination types or scan states that could not be resolved

Source forms distinguish descriptive text, raw URLs, cross-reference text, page-item graphics, and inline graphics when the text source resolves to an anchored page item.

The text report contains hyperlink totals, destination categories, schemes, source forms, repetition counts, and the top destination domains. The complete page-by-page inventory remains in the dedicated hyperlink CSV. DocStats also raises review findings for same-page source text that resolves to multiple destinations (`HYP-001`), HTTP destinations (`HYP-002`), and suspicious trailing URL punctuation (`HYP-003`).

## Statistics reported

DocStats reports:

- pages, spreads, and layers
- stories and text frames
- threaded and standalone text frames
- words, characters, paragraphs, and composed lines
- tables, footnotes, and endnotes
- graphics and link states
- fonts and style counts
- hyperlinks by internal/external category, cross-reference sources, bookmarks, and Articles panel entries

## Reports

The palette can save:

- a UTF-8 text report containing statistics, hyperlink summary, findings summary, and detailed findings
- a CSV findings report with severity, scope, selected profile, code, page, object-location fields, detail, and available action
- a CSV hyperlink inventory with direction, destination category, scheme, domain, source form, repetition metadata, page, source text or graphic, destination, and object-location fields

## Installation

1. Download `DocStats.jsx`.
2. In InDesign, open **Window > Utilities > Scripts**.
3. In the Scripts panel, reveal the User scripts folder.
4. Place `DocStats.jsx` in that folder.
5. Open an InDesign document.
6. Double-click `DocStats.jsx` in the Scripts panel.

DocStats opens as a palette so the document remains interactive while findings are being located and reviewed.

## Safety model

The scan does not modify the document. Automated remediation is intentionally narrow:

- update an out-of-date link
- relink a missing asset to a file chosen by the operator
- write custom EPUB alternate text entered by the operator
- designate the first table row as a header after confirmation
- write document title or author metadata entered by the operator

DocStats does not silently change layout, resize frames, substitute fonts, anchor objects, alter reading order, or rewrite export settings.

## Compatibility

`DocStats.jsx` uses Adobe ExtendScript / ECMAScript 3 and targets Adobe InDesign. The script intentionally avoids modern JavaScript syntax so it can run in the ExtendScript engine.

A future UXP implementation may use an `.idjs` or plugin architecture, but the ExtendScript version remains the current executable.

## Project documents

- [`docs/FINDINGS.md`](docs/FINDINGS.md): finding design, severity rules, and remediation policy
- [`docs/ROADMAP.md`](docs/ROADMAP.md): planned expansion areas
- [`CHANGELOG.md`](CHANGELOG.md): release history

## The suite

DocStats is the inventory and reporting member of the Localis InDesign tool
suite. Each tool owns a defined region of the document and defers to its
neighbors outside that region.

| Tool | Purpose | Safety posture |
|---|---|---|
| [DocStats](https://github.com/johnwinstondarby/DocStats) | Document inventory, health, and output-readiness reporting | MODIFIES ON EXPLICIT SELECTION |
| [StyleFix](https://github.com/johnwinstondarby/stylefix) | Unused and duplicate character style audit | READ-ONLY |
| [HeaderFix](https://github.com/johnwinstondarby/HeaderFix) | Section header style auditing and correction | MODIFIES DOCUMENT-WIDE ON COMMAND |
| [NormalFix](https://github.com/johnwinstondarby/NormalFix) | `Normal+` body paragraph auditing and correction | MODIFIES ON EXPLICIT SELECTION |
| [TableFix](https://github.com/johnwinstondarby/TableFix) | Table header semantics and paragraph style normalization | MODIFIES ON EXPLICIT SELECTION |

### Suite governance

This repository is the canonical home for suite-wide governance until the
`localis-indesign-tools` repository exists:

- [Suite Harmonization Specification](SUITE_HARMONIZATION.md)

These documents are single-copy. Other repositories link to them rather than
carrying their own version.

## Status

DocStats is an early operational tool. Run it against representative production documents before relying on a new finding or action in a publishing workflow. Finding codes are intended to remain stable as the checks mature.
