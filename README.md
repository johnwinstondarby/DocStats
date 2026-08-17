# DocStats

DocStats is an Adobe InDesign document statistics, health, and output-readiness scanner. It is designed to help an operator answer two questions before export:

1. What is in this document?
2. Which findings need attention, where are they, and what can be done next?

The current implementation is an ExtendScript (`.jsx`) script for Adobe InDesign.

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
| DOC-006 | ERROR | Font unavailable | Manual review |
| DOC-007 | WARNING | Document has no pages | Manual review |

### Print/PDF

| Code | Severity | Finding | Action |
|---|---|---|---|
| PRINT-001 | WARNING | Bitmap below advisory effective-PPI threshold | Locate |

The default advisory threshold is 200 PPI and can be changed in `MIN_PRINT_PPI` near the top of `DocStats.jsx`. Required resolution depends on the output process, line screen, source content, and viewing distance.

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

## Statistics reported

DocStats reports:

- pages, spreads, and layers
- stories and text frames
- threaded and standalone text frames
- words, characters, paragraphs, and composed lines
- tables, footnotes, and endnotes
- graphics and link states
- fonts and style counts
- hyperlinks, cross-reference sources, bookmarks, and Articles panel entries

## Reports

The palette can save:

- a UTF-8 text report containing statistics and findings
- a CSV findings report with severity, scope, code, page, location, detail, and available action

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

## Status

DocStats is an early operational tool. Run it against representative production documents before relying on a new finding or action in a publishing workflow. Finding codes are intended to remain stable as the checks mature.
