# InDesign Tool Suite Harmonization Specification

**Scope:** DocStats, HeaderFix, NormalFix, TableFix
**Deferred:** StyleFix adopts after its v1.0.8 canary passes. Nothing here requires a change to StyleFix while that work is in progress, and the contracts below are written so StyleFix can adopt them without redesign.
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
```

The build inliner concatenates the required core modules with the tool source and writes one file to `dist/`, stamping a header block with tool version, core version, build timestamp, and a hash of each contributing source file.

This resolves three separate problems at once. Practitioners install one file. Installed-artifact parity becomes trivially checkable, because there is one artifact. The multi-module loader parity mechanism StyleFix is currently carrying becomes unnecessary rather than permanent.

A GitHub Action runs the build and fails on any mismatch between the committed `dist/` file and a fresh build.

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

#### Current implementation status

**Running update: 2026-08-19.** The v1 design decisions below are accepted for the shared transaction component. NormalFix is the first proving ground because its current partial-mutation path is compact and already demonstrates the failure class `core/mutate` is intended to eliminate. The mutation canary is built and passed before NormalFix depends on the component. DocStats is the second adopter, beginning with the higher-consequence `relinkAsset` path. TableFix and HeaderFix follow where they mutate document state. StyleFix remains deferred until its v1.0.8 canary work is complete.

No production tool has adopted `core/mutate` yet. The current work is the portable contract and its independent canary.

#### Portable transaction boundary

`core/mutate` owns transaction mechanics and carries no tool-specific knowledge about paragraphs, tables, links, headers, styles, or metadata. Each tool supplies an adapter that knows how to locate, inspect, change, verify, and restore its own target type.

The conceptual contract is:

```javascript
transaction(label, targets, {
    resolve,          // re-acquire the target from its stable locator
    precheck,         // re-verify eligibility immediately before the change
    snapshot,         // capture the state required for explicit restoration
    rollbackDigest,   // capture an independent wide-net proof signature
    mutate,           // perform the requested change
    verify,           // read the changed state back from the document
    rollback          // restore the captured state
});
```

The shared engine owns sequencing, undo grouping, state assignment, hard-stop behavior, and the transaction journal. The adapter owns domain correctness.

#### Stable target identity

A live InDesign object reference is not a durable transaction identity. Recomposition can invalidate text objects, and a prior mutation can alter the coordinates of later targets.

Each requested target therefore enters the transaction as a stable locator. `resolve()` re-acquires the live object at every stage that needs it. Targets are resolved per item at the moment of use rather than resolved for the whole batch in advance.

For text targets, story identity plus a character offset range is the first locator pattern to validate during the NormalFix adapter work. The exact locator contract remains adapter-specific so future adopters can use a more appropriate stable identity.

#### Snapshot and rollback readiness

`snapshot()` captures the state required to reconstruct the properties the adapter is prepared to restore. A snapshot also reports whether restoration is currently possible:

```javascript
{
    rollbackReady: true,
    rollbackReason: "",
    state: {
        // adapter-specific captured state
    }
}
```

Recording an old value and proving that the value can be restored are separate conditions. A relink snapshot, for example, is not rollback-ready merely because it recorded the former path if restoration requires an asset that is no longer available.

A target that is not rollback-ready does not mutate. The journal records the refusal reason.

#### Snapshot and rollback digest are independent

The snapshot exists to restore. The rollback digest exists to prove restoration.

`rollbackDigest()` must be derived independently from the snapshot property list. Reusing the snapshot fields for rollback verification creates a circular test: an uncaptured property would also be absent from the proof and could remain changed without detection.

The transaction engine captures the digest before mutation and captures it again after rollback. The two digests must match. This is a binding design rule for every adapter.

The canary includes a deliberate violation: a mutation changes a property that the snapshot does not capture. Rollback restores the captured fields, but the independent digest must detect the residue and force a hard stop. A canary that allows this case to pass has not proved the rollback layer.

#### Batch Undo and per-item rollback

The suite standard is **one InDesign Undo entry per explicit user command**.

The whole mutation batch runs inside `app.doScript` with `UndoModes.ENTIRE_SCRIPT` and the supplied label. Nested per-item `doScript` calls do not provide granular Undo entries inside that outer group, so per-item recovery is implemented explicitly from snapshots.

The two mechanisms have separate purposes:

- **Rollback** is engine-controlled recovery of one failed target inside the running transaction.
- **Undo** is operator-controlled reversal of the completed user command.

If one target rolls back successfully while other targets commit, the batch can still complete. Pressing Undo then reverses the entire user command, including all committed targets in that batch.

If rollback cannot be proved, the batch hard-stops. The operator message states plainly that one Undo reverses the entire batch command, including earlier committed items.

No per-item rollback implementation uses blind `app.undo()`.

#### Per-target flow

```text
LOCATOR
   |
RESOLVE
   |
PRECHECK
   | eligible
SNAPSHOT + ROLLBACK-READINESS CHECK
   | ready
PRE-MUTATION ROLLBACK DIGEST
   |
MUTATE
   |
VERIFY BY READ-BACK
   | pass
COMMITTED

If MUTATE throws or VERIFY fails:
   |
ROLLBACK FROM SNAPSHOT
   |
RE-ACQUIRE TARGET
   |
POST-ROLLBACK INDEPENDENT DIGEST
   |
   +-- digest matches --> ROLLED_BACK
   |
   +-- rollback throws, target cannot be resolved,
       or digest differs --> HARD_STOP
                                |
                                +-- halt batch
                                +-- remaining targets NOT_ATTEMPTED
```

#### Required item and batch states

Every requested target ends in exactly one item state:

| State | Meaning |
|---|---|
| `COMMITTED` | Mutation applied and read-back verification passed. |
| `SKIPPED` | Mutation was declined before change. The journal records the reason, including a failed precheck or rollback-readiness refusal. |
| `ROLLED_BACK` | Mutation was attempted, restoration ran, and the independent post-rollback digest matched the pre-mutation digest. |
| `HARD_STOP` | Restoration failed, the target could not be re-acquired, or restoration could not be proved. State for that item is uncertain within the bounds of the transaction contract. |
| `NOT_ATTEMPTED` | The batch halted before this target was reached. |

A mutation batch ends in exactly one batch state:

- `COMPLETE`
- `HALTED`

The journal records the failure stage separately from the final state. For example, both a mutation exception and a verification failure can end as `ROLLED_BACK`, while `failureStage` identifies `MUTATE` or `VERIFY`.

`HARD_STOP` always halts the batch.

#### Read-back verification is required

`verify()` re-acquires the target and reads the changed state from the document. It never infers success from the absence of an exception or from the value that was written.

This closes two existing silent-success paths. NormalFix can currently report "Could not verify" after leaving a character-style assignment in place, and DocStats `setCustomAltText` can return success after `customAltText` is written even when `altTextSourceType` did not change as required.

#### Bounded rollback guarantee

Manual rollback restores captured properties and proves the result against the adapter's independent digest. That guarantee is intentionally bounded.

An InDesign mutation can also trigger recomposition, reflow, overset changes, nested or GREP style application, anchored-object movement, or other composed-state effects. Restoring captured properties does not by itself prove that the whole document is bit-for-bit identical to its earlier state.

Accordingly, `ROLLED_BACK` means:

> The adapter restored the captured state and the independent rollback digest matched its pre-mutation value.

It does not claim complete document equivalence. The outer InDesign Undo remains the full-command backstop, and the real-DOM canary verifies that one Undo restores the pre-batch document digest.

#### Dry-run mode

`core/mutate` supports a dry-run execution mode for adapters that can plan safely without writing. Dry run performs target resolution, precheck, snapshot-readiness assessment, and the verification plan while suppressing mutation and rollback.

Dry-run results are planning results and do not use the mutation final-state taxonomy above. This keeps `COMMITTED`, `ROLLED_BACK`, and related states tied to real document consequences.

#### Transaction journal

Every transaction produces a journal entry per requested target. The shared fields are:

```text
target locator
precheck result
snapshot captured
rollback ready
rollback readiness reason
pre-mutation digest captured
mutation attempted
mutation result
verification result
rollback attempted
rollback result
post-rollback digest result
failure stage
final item state
error text
timestamps
```

The batch journal also records:

```text
batch label
execution mode
undo label
targets requested
committed
skipped
rolled back
hard stops
not attempted
batch state
further mutations aborted
```

The journal exists in memory during execution and must be flushed to durable storage on batch completion and immediately on `HARD_STOP`. The persistence mechanism may be supplied by the tool or the later shared reporting layer, but loss of the hard-stop record is not an acceptable normal path.

#### Mutation canary

The safety mechanism is proved independently before production integration.

| ID | Case | Expected result |
|---|---|---|
| T01 | Precheck passes, mutate succeeds, verify passes | `COMMITTED`; rollback never invoked |
| T02 | Precheck declines | `SKIPPED`; target unchanged |
| T03 | Mutate throws after mutation is eligible | Rollback runs; `ROLLED_BACK` if restoration proves clean |
| T04 | Mutate succeeds, verify fails | Rollback runs; `ROLLED_BACK` if restoration proves clean |
| T05 | Rollback throws | `HARD_STOP`; batch `HALTED` |
| T06 | Rollback reports success but post-rollback digest differs | `HARD_STOP`; batch `HALTED` |
| T07 | Mutation changes an intentionally uncaptured property and rollback is forced | Independent digest detects residue; `HARD_STOP` |
| T08 | Mixed batch: several commit and one rolls back successfully | Committed targets remain changed, failed target restored, batch `COMPLETE` |
| T09 | Hard stop at item 4 of 10 | Items 5 through 10 are `NOT_ATTEMPTED`; batch `HALTED` |
| T10 | Full real-DOM batch followed by one InDesign Undo | Document matches the pre-batch document digest |
| T11 | Mutation invalidates the original target reference | Re-acquisition succeeds and verification still runs |
| T12 | Re-run against already-correct targets | Targets decline through precheck; no second mutation |

The canary has two tiers:

- **Synthetic tier:** T01 through T09 and T12. These exercise pure transaction logic with deterministic synthetic targets and require no open InDesign document.
- **Real-DOM tier:** T10 and T11. These exercise InDesign Undo integrity and object invalidation against a real document because those behaviors cannot be proved by synthetic objects.

T07 is mandatory. It proves that rollback verification is independent from the snapshot rather than a restatement of the same captured property list.

#### Adoption order within `core/mutate`

1. Freeze the portable contract.
2. Build and pass the synthetic mutation canary.
3. Build and pass the real-DOM mutation canary.
4. Integrate the NormalFix mutation adapter.
5. Verify NormalFix repair, rollback, hard-stop, journal, and one-step Undo behavior.
6. Integrate DocStats, beginning with `relinkAsset`.
7. Extend the same contract to remaining mutation paths without introducing tool-specific transaction forks.

TableFix already implements part of the snapshot-and-restore pattern for cell fills. That prior behavior is useful input, but the shared contract above governs future adoption.

### 3.6 `core/report`

The findings model, the code registry loader, and the CSV writer.

CSV output rules for every tool: UTF-8 with BOM, Windows line endings, all fields quoted, control characters escaped to printable form before writing. The v1.0.7 StyleFix CSV contains a raw `\u0004` from a footnote marker, which reads as file corruption to a strict consumer.

**Provenance header.** Every CSV from every tool opens with the same `#`-prefixed block:

| Field | Note |
|---|---|
| Tool name, tool version | |
| Core version, build hash | from the generated header |
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

Applies to all five repositories.

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

**Note on safety posture.** Writing this down forces an existing inconsistency into the open. NormalFix and TableFix both state that selection is the remediation boundary and that no document-wide Fix All exists. HeaderFix provides Fix All Errors and Clear All Overrides. The exception may be defensible, since the marker population is small and unambiguous, but three tools in one suite should not carry two safety postures by accident.

**DocStats.** The repository holds a released v1.1.0 script of roughly 1,800 lines, a README, a CHANGELOG, and findings and roadmap documents. It is the most mature tool in the suite and the closest to this standard already: it has a CHANGELOG, uses the `ERROR` / `WARNING` / `INFO` severity axis, and documents its finding codes. It needs a LICENSE, a tag, a `.gitattributes`, an accurate safety-posture line, and CSV provenance.

Its safety posture is `MODIFIES ON EXPLICIT SELECTION`, not `READ-ONLY`. Scanning is read-only; five guarded actions are not. Any statement to the contrary in a README or ownership document is a defect in the highest-consequence field of this standard and should be corrected on sight.

In the ownership model DocStats is the inventory tool, and the style census StyleFix needs belongs there so that two tools do not count the same population independently.

---

## 7. Adoption sequence

Ordered so that the highest-risk condition clears first and no step depends on a later one.

1. **`core/mutate`, adopted by NormalFix and DocStats.** Undo grouping, per-item rollback, and read-back verification. This is the only step addressing conditions capable of damaging a document in the suite's current state. Within it, NormalFix's partial-mutation path and DocStats `relinkAsset` are the two highest-consequence items.
2. **`core/color`.** The name-bypass and tint corrections. Adopted by NormalFix and TableFix together.
3. **`core/text` and its adoption by HeaderFix.** Removes the last direct `applyParagraphStyle` call in the suite.
4. **Ownership corrections.** DocStats `EPUB-004` reports rather than remediates. The unowned complex-table region gets an owner or an explicit `UNOWNED` entry.
5. **Suite repository, ownership map, code registry, build inliner.** Structural work with no behavioral change.
6. **`core/report` and `core/ui`.** Provenance, CSV BOM and control-character sanitization, listbox, and document rebinding. DocStats binds `app.activeDocument` once at load and never rebinds, so it can report against a document that is no longer active.
7. **Repository metadata across all repositories.** License, tags, changelog, actions, topics.
8. **DocStats census work.** Style census across all style classes, and an independent instance census. The instance census closes the `NO_APPLICABLE_INSTANCE` hole in StyleFix: a capability matrix claiming zero tables can be checked against an independent count rather than believed. Much of the counting already exists in the v1.1.0 statistics block.
9. **StyleFix adopts core.** After v1.0.8 passes its canary. The multi-module loader parity mechanism retires at this point, replaced by single-file distribution.

Steps 1 through 4 are defect corrections and should not wait on the structural work in step 5. The shared modules can begin life inside one tool and move to the suite repository when it exists.
