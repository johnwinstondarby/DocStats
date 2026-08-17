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

### Changed

- production health output is now structured as individual findings rather than a short warning summary
- links report their page/location when resolvable
- scan output separates statistics from actionable findings

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
