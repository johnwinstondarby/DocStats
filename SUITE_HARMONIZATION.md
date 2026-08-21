# InDesign Tool Suite Harmonization Specification

**Scope:** DocStats, HeaderFix, NormalFix, TableFix
**Deferred:** StyleFix adopts after its v1.0.8 canary passes. Nothing here requires a change to StyleFix while that work is in progress, and the contracts below are written so StyleFix can adopt them without redesign.
**Cross-cutting suite service:** ScriptWatch spans the tool suite as shared observability infrastructure and does not own document regions. Suite tools adopt the ScriptWatch Harness so they can publish job semantics to the ScriptWatch console. External or community scripts may opt in to the same Harness contract. ScriptWatch retains agentless process and host telemetry when no Harness is present.
**Status:** Proposed. Editorial authority is Johann Darby.

**Canonical location:** this document lives in the DocStats repository and is the single authoritative copy. Other repositories link to it and never carry their own copy. A specification that exists to prevent divergence must not itself be duplicated.

**Planned relocation:** when the `localis-indesign-tools` suite repository is created (section 7, step 4), this document relocates there together with the ownership map and the finding code registry. The DocStats copy is then replaced by a link. Any repository README pointing here is updated in the same pass.

---

## 1. Why harmonize before fixing

Four repositories currently carry four independent copies of the same helper functions: validity checks, guarded property reads, object type resolution, preview truncation, column padding, location resolution, override detection, color conversion, and CSV writing.

Those copies have already diverged in a way that produced a defect. NormalFix v1.5 replaced `applyParagraphStyle(style, true)` with the character-style-preserving pattern because the older call destroyed applied character styles. HeaderFix still uses the older behavior. The same lesson was learned once and applied once.

Every additional per-tool fix without a shared core recreates that condition.

---

## 2. Distribution model

ExtendScript has no package manager, and the audience for a community release is practitioners rather than developers. The model that resolves both constraints:

**Source is modular. Distribution is a single generated file.**

```
localis-indesign-tools/          suite repository
    core/                        shared modules
    ownership/OWNERSHIP.md       ownership map (authoritative)
    codes/CODES.csv              finding code registry (authoritative)
    build/build.py               inliner
tool repositories                one per tool, consuming core
    src/                         tool-specific source
    dist/ToolName.jsx            generated, committed, installable
ScriptWatch repository           cross-cutting runtime observer
    ScriptWatchHeartbeat.jsxinc  heartbeat transport
    ScriptWatchJob.jsxinc        ScriptWatch Harness
```

The build inliner concatenates the required core modules with the tool source and writes one file to `dist/`, stamping a header block with tool version, core version, build timestamp, and a hash of each contributing source file.

This resolves three separate problems at once. Practitioners install one file. Installed-artifact parity becomes trivially checkable, because there is one artifact. The multi-module loader parity mechanism StyleFix is currently carrying becomes unnecessary rather than permanent.

A GitHub Action runs the build and fails on any mismatch between the committed `dist/` file and a fresh build.

ScriptWatch remains a cross-cutting repository rather than a document-ownership tool. For suite builds, `ScriptWatchHeartbeat.jsxinc` and `ScriptWatchJob.jsxinc` are source components and are inlined into the generated single-file distribution with the other required modules. Practitioners still install one generated `.jsx` file. Authors integrating ScriptWatch into a script outside the suite may include the two `.jsxinc` files directly.

---

## 3. Core modules

### 3.1 `core/dom`

`valid()`, `safeProperty()`, `safePropertyObject()`, `objectTypeName()`, `collectionElements()`, and the DOM contract registry.

**Contract registry rule:** no DOM property or method name appears as a bare literal at a call site in any tool. Every name is declared in the registry, probed at startup, and resolved through an accessor. A name that was never registered stops the run.

This is the class-level fix for the recurring wrong-name defect. Four instances are on record: `language` for `appliedLanguage`, `endnotes` on the wrong host, `applyCharacterStyle` on Story, and `indexOptions` for `indexGenerationOptions`. Each was found individually. The registry is what finds the fifth before it ships.

The registry uses the five-state taxonomy already accepted for StyleFix: `SUPPORTED`, `NOT_APPLICABLE`, `NO_APPLICABLE_INSTANCE`, `NOT_EXPOSED`, `FAILED`.

### 3.2 `core/text`

- `overrideState(para)` returning both the value and the detection method used.
- `applyCanonicalParagraphStyle(para, style)` implementing the NormalFix v1.5 pattern: apply without clearing character attributes, then clear paragraph-only overrides, with the enum path and the numeric fallback both recorded.
- `characterStyleSignature(text)` and `formattingSignature(text)` for preservation verification.

**Binding rule:** no tool calls `applyParagraphStyle` directly. The preserving pattern is the only paragraph-style application path in the suite. This closes the HeaderFix divergence permanently rather than by patch.

### 3.3 `core/color`

`colorToRGB()`, `swatchName()`, `isRedFamily()`, and tint-aware evaluation. NormalFix and TableFix currently implement red detection separately for `CLI Code Red Body` and `CLI Code Red Table`. The hue logic is one function; the target style name is a parameter.

Two corrections belong here rather than in either tool:

- The swatch-name test must not bypass color analysis. A name containing "red" as a substring currently short-circuits the hue check, so a brown swatch named Redwood is accepted without examination. Name becomes a supporting signal, or an exact match against a configured list.
- `fillTint` must be evaluated. A tinted instance of a red swatch renders pale, matches on swatch identity, and is currently converted to full strength. Tinted instances are reported for review rather than converted silently.

### 3.4 `core/location`

One container-aware location resolver. The current implementations fail to resolve a page whenever text sits inside a table, an anchored frame, or a group, which was confirmed in the StyleFix v1.0.7 canary run: C14, whose own literal reads "table on parent page," resolved as `No page/Pasteboard`, while C08 on the same parent page resolved correctly.

Location never determines risk in any tool. It determines whether a practitioner can act on a finding, which is the safety net for every row the tool declines to fix automatically. One correct implementation serves all four.

### 3.5 `core/mutate`

The mutation transaction. Every change to a document in every tool passes through it.

```
transaction(label, targets, {
    precheck,    // re-verify eligibility immediately before the change
    snapshot,    // capture everything that must survive
    mutate,      // perform the change
    verify,      // compare post-state against snapshot
    rollback     // restore on verification failure
})
```

Four tools mutate documents, not three. DocStats v1.1.0 carries five guarded actions: link update, relink, alternate-text entry, table header-row designation, and metadata entry. No tool in the suite currently groups undo or rolls back.

Three properties, all currently missing across the suite:

**Batch-level undo grouping.** The whole transaction runs inside `app.doScript` with `UndoModes.ENTIRE_SCRIPT` and the supplied label, so a batch is one undo step rather than dozens.

**Per-item rollback.** A verification failure restores that item rather than leaving the document partly changed. NormalFix currently assigns the red character style, then applies the paragraph style, then verifies, and on failure returns "Could not verify" while leaving the character-style assignment in place. The document has been modified and the report does not say so.

**Read-back verification as a required stage.** `verify` re-reads the changed property from the document rather than trusting the write. Two tools have independently produced the same silent-success defect: NormalFix reports "Could not verify" while leaving a change in place, and DocStats `setCustomAltText` writes `customAltText`, silently swallows a failure to set `altTextSourceType`, and returns success. In both cases the report claims a state the document does not have.

TableFix already implements half of this pattern with its cell-fill snapshot and restore. Generalizing that instinct into the shared contract is most of the work.

Highest-consequence action currently unguarded: DocStats `relinkAsset` replaces a placed asset with no confirmation beyond the file dialog, captures nothing about the original, and offers no restore.

### 3.6 `core/report`

The findings model, the code registry loader, and the CSV writer.

CSV output rules for every tool: UTF-8 with BOM, Windows line endings, all fields quoted, control characters escaped to printable form before writing. The v1.0.7 StyleFix CSV contains a raw `\u0004` from a footnote marker, which reads as file corruption to a strict consumer.

**Provenance header.** Every CSV from every tool opens with the same `#`-prefixed block:

| Field | Note |
|---|---|
| Tool name, tool version | |
| Core version, build hash | from the generated header |
| ScriptWatch Harness version | exact Harness contract when instrumented; `NOT_INSTRUMENTED` when no Harness is present |
| Run timestamp | |
| Document name, path, file modified | |
| InDesign version and build | report `NOT_EXPOSED` rather than an empty field |
| Operating system | |
| Ownership scope | what this tool claims, from the ownership map |
| Mutation state | `AUDIT_ONLY` or `MUTATED`, with the undo label when mutated |
| Counts by finding code | |

A report that cannot be traced to the code that produced it cannot be entered into an errata record six weeks later.

### 3.7 `core/ui`

Palette scaffold, multi-column listbox with sortable headers, the standard button row, Save CSV, and Save Diagnostic.

Two fixes land here for all four tools simultaneously. Space-padded columns do not align in the proportional ScriptUI default font, so a real multi-column listbox replaces `fixed()` padding. And the open-document guard must run inside the scan and every action handler, not once at load. With `#targetengine` the palette outlives the document, so closing it and clicking Rescan currently throws in NormalFix and did in StyleFix.

### 3.8 `core/boot`

Version constants, artifact parity check, measurement-unit normalization to points with restore, and redraw suppression with restore.

### 3.9 Cross-cutting observability: ScriptWatch

ScriptWatch is horizontal suite infrastructure. It observes DocStats, HeaderFix, NormalFix, TableFix, StyleFix when adopted, and future tools through two independent acquisition paths.

**Agentless acquisition.** `scriptwatch.py` observes the InDesign process and host from outside InDesign and writes the canonical telemetry CSV. This path requires no modification to the observed script and remains available when a script publishes no heartbeat. The v1 collector surface includes process CPU, private memory, working set, threads, handles, cumulative read/write/other I/O bytes and operations, page faults, Windows GDI and USER object counts when available, process uptime, host physical-memory use, system commit charge, system cache, kernel paged/nonpaged pools, and system process/thread/handle counts. Unsupported counters remain unavailable rather than being assigned a different meaning. `scriptwatch_web.py` consumes the collector snapshot and does not maintain a second host-memory sampler.

**Harness acquisition.** The ScriptWatch Harness is the reusable code part a script includes when it wants the ScriptWatch console to understand the work inside the process. The canonical source components live in the ScriptWatch repository and are included in this order:

```javascript
#include "ScriptWatchHeartbeat.jsxinc"
#include "ScriptWatchJob.jsxinc"
```

`ScriptWatchHeartbeat.jsxinc` owns the fail-isolated heartbeat transport. `ScriptWatchJob.jsxinc` owns the shared job contract and is the preferred adoption point for suite tools. Observation failure must never stop the tool. If the heartbeat transport is absent or unavailable, Harness calls degrade to no-op observation while tool work continues.

**Current contract:** ScriptWatch Harness 1.2 and heartbeat schema 1.2. Harness 1.2 publishes structured `tool`, `toolVersion`, `harnessVersion`, `mode`, and heartbeat `schemaVersion` fields in addition to the human-readable `<tool> · harness <version>` note prefix. The collector persists those fields directly in CSV so provenance does not depend on parsing display text.

The Harness provides two execution shapes:

- `ScriptWatchJob.run()` for collection-driven work where one outer-loop target is the ETA unit.
- `ScriptWatchJob.begin()` for phase-driven work where the tool advances through named stages rather than a target collection or where another subsystem already owns sequencing.

The shared Harness contract standardizes target progress, PASS/FAIL counts, checkpoint cadence, notes, terminal state, and Harness version provenance. `false` and thrown errors report FAIL; any other return reports PASS. A failing target continues by default. `continueOnError: false` converts the first failure into an `ABORTED` terminal state and rethrows to the caller. Terminal publication occurs in `finally` so a completed or aborted tool does not leave a live RUNNING heartbeat behind.

**Custom metrics.** Harness 1.2 provides `session.metric(name, value, opts)` for bounded domain telemetry that ScriptWatch cannot know generically. A job may publish up to 32 current finite numeric metrics. Metadata may include `unit`, `min`, `max`, `note`, and `display` (`counter`, `dial`, or `trend`). Unsupported display values normalize to `counter`. The heartbeat and CSV retain the metadata. The current dashboard renders custom metrics as number-in-box counters; richer presentation can use the existing metadata without changing the producer contract. This channel prevents tool-specific counters from expanding or redefining the fixed process/host telemetry schema.

**Persistent-engine boundary.** Each heartbeat `start()` resets prior metrics, counters, notes, timing, and lock state so a persistent ExtendScript engine cannot carry one job's observability state into the next job.

**Integration boundary with `core/mutate`.** ScriptWatch observes work; `core/mutate` owns document mutation safety. Harness progress, checkpoints, notes, status, and custom metrics must not replace target re-resolution, precheck, snapshot, digest coverage, verification, rollback, durable mutation journaling, or batch hard-stop semantics. A mutation tool whose loop is owned by `core/mutate` uses the phase/session Harness form or an explicit reporting bridge rather than creating a second competing target loop.

**Third-party integration.** A script outside the suite can become ScriptWatch-aware by adding the two Harness code parts and describing its work through `run()` or `begin()`. The external observer remains useful without that integration, but only Harness-enabled scripts can publish semantic job data such as target count, PASS/FAIL, checkpoint, phase notes, terminal state, structured provenance, and custom domain metrics.

**Contract canaries.** ScriptWatch carries dependency-free collector, dashboard-contract, Harness, and heartbeat canaries. They pin stale-terminal discovery, CSV column uniqueness, stable host-counter schema, legacy CSV report compatibility, structured provenance, custom metric forwarding/serialization, fail-fast terminal behavior, lock release, and persistent-engine reset behavior before a suite tool adopts the Harness.

---

## 4. Finding codes and severity

Two shared registries, both living in the suite repository and read by the tools rather than restated in each README.

**Code prefixes are not required to name their tool.** DocStats already publishes family-based codes (`DOC-`, `HYP-`, `PRINT-`, `EPUB-`) and its FINDINGS.md commits to keeping published codes stable. Requiring tool-named prefixes would break that for no benefit. The registry carries a Tool column instead, so a code's owner is recorded rather than encoded in its name. HeaderFix keeps `H1-`.

Codes remain globally unique across the suite. A check whose meaning changes substantially receives a new code rather than being repurposed, and letter suffixes may identify stages of one check family, as with `DOC-006A` and `DOC-006B`.

**Severity is one axis for all tools:** `ERROR`, `WARNING`, `INFO`, `PASS`.

**Classification is a separate, tool-specific column.** StyleFix's LOW, MEDIUM, HIGH, and REPLACE are a risk classification, not a severity, and collapsing them into the severity axis would make the two incomparable across tools. TableFix's REVIEW is similarly a classification rather than a severity.

`codes/CODES.csv` carries one row per code across the whole suite: code, tool, family, severity, meaning, remediable yes or no, and the ownership region it applies to.

---

## 5. Ownership map as an artifact

The ownership boundary currently lives as prose in four separate READMEs, and the prose does not cover the whole document.

One gap is already visible. NormalFix excludes every paragraph inside a table and defers to TableFix. TableFix refuses to remediate complex tables, which are those with merged or spanned cells or multiple header rows, marking them `TF-003` and never changing them. A `Normal+` paragraph inside a complex table is therefore excluded by NormalFix and declined by TableFix. It is owned by nobody, and nothing in either tool reports that condition.

A second overlap is already in shipped code. TableFix owns tables and owns header-row semantics. DocStats `EPUB-004` remediates the same condition by setting `headerRowCount`, so two tools mutate one region under different verification standards. DocStats should report the condition and defer the change.

`ownership/OWNERSHIP.md` becomes the single authority: a table of every document region, the tool that owns it, and what that tool does with it. Regions with no owner are listed explicitly as `UNOWNED` rather than being absent. Each tool README links to it instead of restating it, so the map cannot drift out of agreement with itself.

---

## 6. Repository metadata standard

Applies to the five document-tool repositories and to the ScriptWatch repository where applicable.

| Item | Standard |
|---|---|
| `LICENSE` | Present. None of the repositories currently has one, which leaves a tool that modifies a user's document legally ambiguous to use. |
| No-warranty statement | In the README, in plain language, not only in the license text. |
| `README.md` | Fixed section order: what it does, safety posture, install, usage, finding codes, ownership boundary link, compatibility, license. |
| Safety posture | Stated near the top in fixed vocabulary: `READ-ONLY`, `MODIFIES ON EXPLICIT SELECTION`, or `MODIFIES DOCUMENT-WIDE ON COMMAND`. A practitioner needs to know in five seconds whether the script will touch their file. |
| `CHANGELOG.md` | Present, one entry per tagged release. |
| Tags | Every release tagged `vX.Y.Z`. No repository currently has a tag, so there is no fixed point to install from. |
| `.gitattributes` | Present in all repositories. Currently only HeaderFix has one. |
| GitHub Action | Build, `dist/` freshness check, version parity check. |
| Repository topics | `indesign`, `extendscript`, `publishing`, `epub`, `typesetting`. Discoverability is the whole point of a community release. |
| Repository description | One descriptive sentence in a consistent register. |
| ScriptWatch integration | Suite tool READMEs identify whether the generated artifact includes the ScriptWatch Harness and record the Harness contract version. External/community tools may document optional Harness integration without adopting suite ownership or mutation contracts. |

**Note on safety posture.** Writing this down forces an existing inconsistency into the open. NormalFix and TableFix both state that selection is the remediation boundary and that no document-wide Fix All exists. HeaderFix provides Fix All Errors and Clear All Overrides. The exception may be defensible, since the marker population is small and unambiguous, but three tools in one suite should not carry two safety postures by accident.

**DocStats.** The repository holds a released v1.1.0 script of roughly 1,800 lines, a README, a CHANGELOG, and findings and roadmap documents. It is the most mature tool in the suite and the closest to this standard already: it has a CHANGELOG, uses the `ERROR` / `WARNING` / `INFO` severity axis, and documents its finding codes. It needs a LICENSE, a tag, a `.gitattributes`, an accurate safety-posture line, and CSV provenance.

Its safety posture is `MODIFIES ON EXPLICIT SELECTION`, not `READ-ONLY`. Scanning is read-only; five guarded actions are not. Any statement to the contrary in a README or ownership document is a defect in the highest-consequence field of this standard and should be corrected on sight.

In the ownership model DocStats is the inventory tool, and the style census StyleFix needs belongs there so that two tools do not count the same population independently.

---

## 7. Adoption sequence

Ordered so that the highest-risk condition clears first and no step depends on a later one.

**ScriptWatch Harness adoption is horizontal rather than a numbered dependency.** Suite tools add the Harness as their current canary/release work permits. Because ScriptWatch observation is fail-isolated and does not own mutation semantics, Harness adoption may proceed in parallel with the steps below and must not delay `core/mutate` safety work. New suite tools include the Harness from their first instrumented build. Harness adoption uses the current pinned contract and passes ScriptWatch's contract canaries before release.

**Production-discrimination precondition.** NormalFix's August 21, 2026 production sweep established a new prerequisite for NormalFix's mutation-adapter work: the host-object identity defect and the production `frameSpanSignature` failure are diagnosed and pass the production-discrimination gates in section 8 before NormalFix advances from read-only proof into production `core/mutate` adoption. ScriptWatch Harness is intentionally absent from the bare diagnostic canary and enters on the first 20-to-50-target post-fix production rerun. This keeps diagnosis and instrumentation adoption as separate variables.

1. **`core/mutate`, adopted by NormalFix and DocStats.** Undo grouping, per-item rollback, and read-back verification. This is the only step addressing conditions capable of damaging a document in the suite's current state. Within it, NormalFix's partial-mutation path and DocStats `relinkAsset` are the two highest-consequence items. NormalFix enters this step only after its section 8 production-discrimination precondition passes.
2. **`core/color`.** The name-bypass and tint corrections. Adopted by NormalFix and TableFix together.
3. **`core/text` and its adoption by HeaderFix.** Removes the last direct `applyParagraphStyle` call in the suite.
4. **Ownership corrections.** DocStats `EPUB-004` reports rather than remediates. The unowned complex-table region gets an owner or an explicit `UNOWNED` entry.
5. **Suite repository, ownership map, code registry, build inliner.** Structural work with no behavioral change.
6. **`core/report` and `core/ui`.** Provenance, CSV BOM and control-character sanitization, listbox, and document rebinding. DocStats binds `app.activeDocument` once at load and never rebinds, so it can report against a document that is no longer active.
7. **Repository metadata across all repositories.** License, tags, changelog, actions, topics.
8. **DocStats census work.** Style census across all style classes, and an independent instance census. The instance census closes the `NO_APPLICABLE_INSTANCE` hole in StyleFix: a capability matrix claiming zero tables can be checked against an independent count rather than believed. Much of the counting already exists in the v1.1.0 statistics block.
9. **StyleFix adopts core.** After v1.0.8 passes its canary and the section 8 production-discrimination gate is applied to its object-valued and sentinel-valued fingerprint fields. The multi-module loader parity mechanism retires at this point, replaced by single-file distribution.

Steps 1 through 4 are defect corrections and should not wait on the structural work in step 5. The shared modules can begin life inside one tool and move to the suite repository when it exists.

---

## 8. Production discrimination and host-object identity

Synthetic canaries establish controlled behavior. Production-shaped discrimination establishes that the fixture model represents the document states the tool will encounter. Both forms of proof are required for property classes that can hide behind default, null, sentinel, object-reference, or container behavior.

### 8.1 NormalFix production-sweep evidence

The August 21, 2026 NormalFix production-manuscript read-only sweep exercised the frozen 243-key read surface against all 2,883 `NF-001` Normal+ targets in a 505-page, 23-story manuscript under InDesign 21.5.1.73 / DOM 21.5.

The sweep established two completed proof surfaces:

- paragraph locator: 2,883 of 2,883 targets resolved to exactly one candidate, with zero locator failures;
- exact-key/applicability contract: zero key-set mismatches and zero unexpected `NOT_APPLICABLE` targets.

The sweep also exposed two unresolved proof surfaces:

- snapshot readiness failed on all 2,883 targets. The recurring failures were `characters.appliedLanguage`, `characters.fillColor`, `paragraph.bulletsCharacterStyle`, and `paragraph.numberingCharacterStyle`. All four are object-valued properties. No scalar or enum property produced this failure class. The initial repair target is therefore the common host-object identity/serialization contract rather than four property-specific patches;
- `composition.frameSpanSignature` was unreadable on all 2,883 targets. That failure is tracked separately from host-object identity. The production sweep used direct `Paragraph.parentTextFrames`; the earlier composition stability canary that passed used line/insertion-point frame resolution. This implementation difference is evidence for the diagnostic hypothesis, not a diagnosis. Shared `core/location` changes wait for production canary evidence identifying the failing operation.

The sweep's roughly 11-hour runtime also exposed a near-linear per-object failure cost. The diagnostic canary records the individual host-resolution operations and the legacy resolver timing before any cache or performance optimization is considered. Correct identity comes before memoization.

### 8.2 Production discrimination gate

A property is subject to the production-discrimination gate when it is any of the following:

- object-valued;
- container-sensitive;
- universally `NOT_APPLICABLE`, null, default-valued, or otherwise sentinel-valued in the available fixture/population;
- dependent on a host collection or host-object re-resolution path whose production cardinality can differ from a synthetic fixture.

Admission to a production proof surface requires:

1. at least one value that existed in the document before the diagnostic script started;
2. a positive discriminating case proving the property can return a real non-default/non-sentinel value where such a value is possible;
3. for host-object identity, a serialize/strict-resolve round trip against document-resident state;
4. a negative/refusal case proving that changed semantic identity, ambiguity, or contradictory supplemental evidence is rejected rather than guessed;
5. production-shaped container coverage for container-sensitive properties;
6. version binding to the InDesign application build and DOM version used for the proof.

A synthetic fixture can satisfy controlled mutation/reconstruction proof but cannot, by itself, satisfy this gate for these property classes.

`characters.kerningValue` remains in the NormalFix coverage set pending a deliberate positive-discrimination case. Universal `NOT_APPLICABLE` on one manuscript is not evidence that the key is dead or meaningful. A deliberate non-default kerning case must prove that the read path can return real state. `characters.strokeColor` similarly requires at least one pre-existing non-default stroke case because the production manuscript may simply lack that state.

### 8.3 Host-object identity contract and proposed `core/identity`

Rollback and digest machinery must store durable semantic identity rather than a live ExtendScript host object or an opaque object reference that is accepted merely because it resolves.

The proposed shared `core/identity` module is promoted only after the NormalFix production and adversarial identity canaries pass. Its contract is:

- **Language:** semantic language name is primary identity; concrete type and ID are supplemental when exposed.
- **CharacterStyle / ParagraphStyle:** qualified style-group path plus leaf name is primary identity; ID is supplemental.
- **Swatch / Color:** document-scoped name is primary identity, with qualified group path included where the host exposes meaningful grouping; ID is supplemental.
- **Font:** PostScript name is primary; full name/name are fallbacks only when PostScript name is unavailable.
- **Other registered host families:** family-specific semantic identity and bounded candidate collection are explicit in the registry.
- **Unknown host families:** `UNSUPPORTED_TYPE`. Generic name matching is prohibited.

Resolution is exact or refused. A style with the same leaf name at a different qualified path is a different style. A renamed or moved object whose stored ID still resolves does not satisfy the old semantic identity. A successful `app.resolve(specifier)` is only a candidate fast path and must pass the same semantic verification before acceptance.

Supplemental signals never override semantic identity:

- semantic identity and supplemental ID agree: `RESOLVED`;
- semantic identity matches but ID disagrees: `IDENTITY_CONFLICT`;
- semantic identity has no candidate but stored ID points to a renamed/moved object: `IDENTITY_CONFLICT`;
- multiple semantic candidates: `AMBIGUOUS_IDENTITY`;
- no candidate: `UNRESOLVED_IDENTITY`.

Any unsupported, unresolved, ambiguous, or conflicting host state makes the snapshot unready and blocks mutation for that target.

Candidate search is family-specific and bounded. Language resolution searches language collections; CharacterStyle resolution searches character styles; Swatch resolution searches swatches; Font enumeration is reserved for Font identity. Cross-family exhaustive fallback is prohibited.

### 8.4 Required NormalFix diagnostic sequence

NormalFix uses two separate canaries before production code changes:

1. **Bare production diagnostic.** Read-only, no ScriptWatch Harness, using selected real targets from the production sweep. It probes `appliedLanguage`, `fillColor`, bullets/numbering CharacterStyle, `strokeColor`, `kerningValue`, object resolution timing, and both frame-span access paths. Its job is diagnosis, not remediation.
2. **Adversarial identity-refusal canary.** Runs only against a disposable saved/reopened document. Duplicate style leaf names in different groups, group/style identity changes, swatch rename, and conflicting supplemental IDs must refuse rather than guess.

After both canaries establish the failure mechanism and the common identity repair passes, a 20-to-50-target production-manuscript rerun adopts ScriptWatch Harness 1.2 for the first time. That run measures correctness, performance, and observability overhead against the pre-Harness long-tail control.

Production `NormalFix.jsx` remains unchanged until these gates complete.

### 8.5 StyleFix inheritance

StyleFix inherits this gate when active work resumes. Its synthetic fingerprint/capability canaries do not by themselves certify object-valued fields such as fill color, stroke color, and applied language. Those fields require production-document discrimination before the LOW set or any remediation decision can rely on them.
