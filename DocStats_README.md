# DocStats

Document health and preflight reporting for Adobe InDesign, oriented toward EPUB, print, and PDF output.

DocStats is the inventory and reporting member of the Localis InDesign tool suite. It reports on the document and changes nothing.

## Safety posture

**READ-ONLY.** DocStats does not modify the document under any circumstance and provides no remediation action.

## Status

The DocStats script is not yet published in this repository. Implementation is in progress; see open pull requests.

This repository currently also hosts the governance documents for the whole tool suite, described below.

## Suite governance

Until the `localis-indesign-tools` suite repository is created, the following documents live here and are authoritative for every tool in the suite:

- [Suite Harmonization Specification](SUITE_HARMONIZATION.md) — shared core modules, distribution model, mutation contract, reporting contract, and repository metadata standard.

The ownership map and the finding code registry will join it here, then move together to the suite repository.

These documents are single-copy. Other repositories link to them rather than carrying their own version.

## The suite

| Tool | Purpose | Safety posture |
|---|---|---|
| [DocStats](https://github.com/johnwinstondarby/DocStats) | Document inventory, health, and preflight reporting | READ-ONLY |
| [StyleFix](https://github.com/johnwinstondarby/stylefix) | Unused and duplicate character style audit | READ-ONLY |
| [HeaderFix](https://github.com/johnwinstondarby/HeaderFix) | Section header style auditing and correction | MODIFIES DOCUMENT-WIDE ON COMMAND |
| [NormalFix](https://github.com/johnwinstondarby/NormalFix) | `Normal+` body paragraph auditing and correction | MODIFIES ON EXPLICIT SELECTION |
| [TableFix](https://github.com/johnwinstondarby/TableFix) | Table header semantics and paragraph style normalization | MODIFIES ON EXPLICIT SELECTION |

Each tool owns a defined region of the document and defers to its neighbors outside that region. The ownership map is the authority on those boundaries.

## Planned scope

DocStats reports document state without judging remediation. Intended coverage includes document and story inventory, style censuses across all style classes, overset and unresolved-location detection, font usage and missing fonts, link state, color space usage, and export-relevant metadata.

The style census matters to the rest of the suite: StyleFix reads it and asserts against it rather than counting the same population independently.

## Compatibility

Written for Adobe InDesign ExtendScript with ECMAScript 3 compatibility.

## License

See LICENSE.

## Warranty

None. These tools are provided as-is. Tools in this suite that modify documents are labeled as such above. Work on a copy, and keep a backup of any document you value before running any tool that reports a posture other than READ-ONLY.
