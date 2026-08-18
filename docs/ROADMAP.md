# DocStats roadmap

DocStats is expected to grow from a statistics script into an InDesign production-health and preflight companion.

## Near-term

### Better location resolution

- expand unavailable-font reporting from first live occurrence to optional all-occurrence navigation
- identify text ranges carrying style overrides
- add previous/next navigation through hyperlink inventory entries
- distinguish page, pasteboard, master/parent page, and anchored-object locations

### Visual targeting

- improve selection and zoom behavior for text ranges and non-page-item findings
- investigate temporary nonprinting markers or overlays for findings that are difficult to see after navigation
- provide previous/next finding navigation

### Print/PDF checks

- extend output-readiness profiles beyond effective PPI to additional print/PDF checks
- color-space and profile review
- transparency and overprint signals where they are operationally useful
- bleed and page-geometry checks
- hidden/nonprinting content review
- integration with InDesign preflight profiles without duplicating native checks unnecessarily

### EPUB checks

- optional network validation of external hyperlink destinations after local syntax and classification checks
- reading-order analysis against Articles panel and export settings
- paragraph and object export-tag review
- heading hierarchy analysis
- table structure beyond header-row presence
- accessibility metadata and language checks
- image decorative/meaningful classification support
- export-setting capture in the report

## Remediation

The action framework will expand only where remediation can remain explicit and bounded. Candidate actions include:

- open the correct InDesign panel for a finding
- repair specific hyperlink destinations
- assign explicit EPUB tags from an approved mapping
- apply approved object-export options
- run a selected native preflight profile

DocStats should continue to avoid broad silent changes such as automatic font substitution or layout reflow.

## Reporting

Planned reporting work includes:

- JSON output for machine processing
- finding suppressions with reason and expiration
- baseline comparison between document revisions
- finding fingerprints so resolved/reintroduced conditions can be tracked
- summary counts suitable for CI or publication release gates
- optional external URL validation reports with response status and redirect-chain capture

## Architecture

The current executable is ExtendScript. Future options include:

- a UXP implementation using the modern InDesign JavaScript runtime
- a shared finding schema usable by ExtendScript and UXP front ends
- command-line processing through InDesign Server where licensing and workflow support it

The finding code and report schema should remain portable across those implementations.
