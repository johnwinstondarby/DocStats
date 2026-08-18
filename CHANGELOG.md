# Changelog

All notable DocStats changes are recorded here.

## 1.1.0 - 2026-08-16

### Added

- persistent ScriptUI palette
- three finding scopes: Document, Print/PDF, and EPUB
- All view across scopes
- severity-rated findings using ERROR, WARNING, and INFO
- stable finding codes
- page/location resolution where the InDesign DOM exposes a target
- Locate action with selection and fit-selection attempt
- guarded remediation framework
- missing-link relink action
- out-of-date link update action
- EPUB alternate-text entry action
- table first-header-row action
- document title and author metadata actions
- Print/PDF effective bitmap PPI check
- EPUB checks for alt text, anchoring, Articles panel use, table headers, and metadata
- CSV findings export
- findings model and roadmap documentation
- object-location fields in findings: object ID, object type, link/file name, frame label/name, geometric bounds, and story/frame ID
- two-stage unavailable-font reporting with `DOC-006A` for live text use and `DOC-006B` for reference-only cases
- output-readiness profiles for effective-PPI policy: General Health, Print Production, and EPUB
- findings summary immediately before detailed findings in the text report
- hyperlink inventory with internal/external direction and destination subcategories
- hyperlink CSV export with source page, source text/graphic, destination, and object-location fields
- hyperlink integrity findings: `HYP-001` for same-page source text with multiple destinations, `HYP-002` for HTTP destinations, and `HYP-003` for suspicious trailing URL punctuation
- hyperlink scheme, domain, source-form, repetition, and destination-occurrence metadata
- inline-graphic source resolution for hyperlink text sources that contain anchored page items
- hyperlink summary reporting with destination categories, schemes, source forms, repetition counts, and top domains

### Changed

- production health output is now structured as individual findings rather than a short warning summary
- links report their page/location when resolvable
- font statistics distinguish referenced fonts from unavailable fonts detected in live text
- scan output separates statistics from actionable findings
- text reports summarize hyperlinks instead of embedding the full page-by-page inventory; the complete inventory remains in the hyperlink CSV

### Safety

- scanning remains read-only
- document changes require an explicit operator action
- broad automatic layout repair remains outside the action framework

## 1.0.0 - 2026-08-16

### Added

- initial document statistics report
- story and text statistics
- overset-story detection
- link-state counts and problem-link list
- font availability reporting
- style counts
- graphics, hyperlink, bookmark, and cross-reference counts
- UTF-8 text report export
