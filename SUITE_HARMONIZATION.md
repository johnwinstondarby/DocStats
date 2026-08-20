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

**Running update: 2026-08-19. Contract status: FROZEN.** The `core/mutate` v1 contract below is frozen for implementation. NormalFix is the first proving ground because its current partial-mutation path is compact and already demonstrates the failure class `core/mutate` is intended to eliminate. The mutation canary is built and passed before NormalFix depends on the component. DocStats is the second adopter, beginning with the higher-consequence `relinkAsset` path. TableFix and HeaderFix follow where they mutate document state. StyleFix remains deferred until its v1.0.8 canary work is complete.

No production tool has adopted `core/mutate` yet. Implementation now proceeds against this frozen contract and its independent canary. A later contract change requires either an observed safety or correctness defect, or an explicit versioned revision of the contract. Refinement alone does not reopen v1.

#### Portable transaction boundary

`core/mutate` owns transaction mechanics and carries no tool-specific knowledge about paragraphs, tables, links, headers, styles, or metadata. Each tool supplies an adapter that knows how to locate, inspect, change, verify, and restore its own target type.

The conceptual contract is:

```javascript
transaction(label, targets, {
    compareLocators,  // deterministic, adapter-safe target ordering
    resolve,          // re-acquire the target from its stable locator
    precheck,         // re-verify eligibility immediately before the change
    snapshot,         // capture the state required for explicit restoration
    digestCoverage,   // declare the exact reviewable key set proved by rollbackDigest
    rollbackDigest,   // return the keyed independent proof structure
    mutate,           // perform the requested change
    verify,           // read the changed state back from the document
    rollback          // restore the captured state
});
```

The shared engine owns ordering, sequencing, undo grouping, state assignment, hard-stop behavior, and the transaction journal. The adapter owns domain correctness.

#### Deterministic target ordering

Batch ordering is deterministic. `core/mutate` sorts a copy of the requested target locators through the adapter's `compareLocators()` function before processing begins.

The comparator must be stable for the same target set. Deterministic ordering exists for reproducibility, journal comparability, and predictable `NOT_ATTEMPTED` sets. It is not the correctness mechanism for target identity.

Stable locators plus stage-by-stage re-resolution carry the correctness guarantee. If an adapter requires a particular order to keep its locators valid, those locators are not stable enough for the `core/mutate` contract and the adapter must redesign its locator strategy before adoption.

NormalFix does not change text length, but its adapter still declares a deterministic order.

The journal records both request count and processing ordinal. After a hard stop, the resulting `NOT_ATTEMPTED` set must be reproducible for the same ordered target set.

#### Stable target identity and resolve semantics

A live InDesign object reference is not a durable transaction identity. Recomposition can invalidate text objects, and a prior mutation can alter the coordinates of later targets.

Each requested target therefore enters the transaction as a stable locator. `resolve()` re-acquires the live object at every stage that needs it. Targets are resolved per item at the moment of use rather than resolved for the whole batch in advance.

For text targets, story identity plus a character offset range is the first locator pattern to validate during the NormalFix adapter work. The exact locator contract remains adapter-specific so future adopters can use a more appropriate stable identity.

Resolve failure is classified by whether mutation may already have begun:

- **Before `mutate()` is invoked:** the document is unchanged for that target. The target ends `SKIPPED`, the journal records `RESOLVE_FAILED`, and the batch continues.
- **After `mutate()` is invoked:** the target may have changed. Failure to re-acquire it for verification or rollback ends `HARD_STOP` because restoration cannot be proved.

The transition point is invocation of `mutate()`, not proof that the first write occurred. A mutation callback that throws may have changed the document before throwing and therefore enters rollback handling.

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

A target that is eligible for change but is not rollback-ready does not mutate. It ends `REFUSED`, and the journal records the safety reason.

#### Snapshot, digest, and declared digest coverage

The snapshot exists to restore. The rollback digest exists to prove restoration. The digest coverage declaration defines the exact boundary of that proof.

Every adapter publishes a human-reviewable `digestCoverage()` result naming the exact keys that `rollbackDigest()` must return. The declaration is journaled with the adapter/version identity and is part of code review for the adapter.

Example:

```javascript
digestCoverage: function () {
    return [
        "appliedParagraphStyle",
        "paragraphOverrides",
        "characterStyleRuns",
        "localCharacterFormatting",
        "contents",
        "redPositions"
    ];
},

rollbackDigest: function (target) {
    return {
        appliedParagraphStyle: ...,
        paragraphOverrides: ...,
        characterStyleRuns: ...,
        localCharacterFormatting: ...,
        contents: ...,
        redPositions: ...
    };
}
```

The engine enforces the declaration. For every digest capture, it compares the sorted key set returned by `rollbackDigest()` with the sorted key set declared by `digestCoverage()`. Missing keys, extra keys, duplicate declaration keys, or a non-keyed digest are adapter-contract failures.

A digest/key mismatch detected before any mutation begins ends the batch `HALTED` with `batchReason` `ADAPTER_CONTRACT_MISMATCH`; no mutation occurs and all requested targets end `NOT_ATTEMPTED`. A mismatch discovered on a later target before that target's `mutate()` invocation ends the batch the same way; the current and later targets are `NOT_ATTEMPTED`, while earlier proven item states remain unchanged.

`rollbackDigest()` must also be derived independently from the snapshot property list. Reusing the snapshot fields for rollback verification creates a circular test: an uncaptured property would also be absent from the proof and could remain changed without detection.

Independence alone is insufficient. The exact-key assertion makes the declaration executable rather than documentary.

The transaction engine captures the keyed digest before mutation and again after rollback. The two keyed structures must match across the declared coverage.

Properties outside both the snapshot and declared digest coverage are outside the `ROLLED_BACK` proof by definition. The contract does not imply otherwise.

##### Inapplicable dimensions are read results

Every declared digest key is always emitted. When a declared dimension has no state for a target, `rollbackDigest()` returns the shared sentinel `Mutate.NOT_APPLICABLE` for that key.

`Mutate.NOT_APPLICABLE` must be the result of reading the declared dimension and finding no state there. An adapter must not determine applicability through a separate predicate that bypasses the dimension read. A separate applicability test can repeat the same mistake before and after rollback and hide residue.

The required pattern is conceptually:

```javascript
readDimension(target)
// returns canonical value when state exists
// returns Mutate.NOT_APPLICABLE when the read finds no state
```

A mutation that creates state in a formerly empty dimension must therefore change that digest key from `Mutate.NOT_APPLICABLE` to a value. Rollback verification then detects any failure to remove the new state.

T07 deliberately changes a property absent from the snapshot but present in the declared digest coverage. Rollback restores the captured fields, and the independent digest must detect the residue and force a hard stop.

A separate coverage-boundary canary deliberately changes a property absent from both the snapshot and declared digest coverage. That case is allowed to end `ROLLED_BACK` even though residue remains, proving the bounded nature of the guarantee rather than implying total equivalence.

#### Batch Undo and per-item rollback

The suite standard is **one InDesign Undo entry per explicit user command**.

The whole mutation batch runs inside `app.doScript` with `UndoModes.ENTIRE_SCRIPT` and the supplied label. Nested per-item `doScript` calls do not provide granular Undo entries inside that outer group, so per-item recovery is implemented explicitly from snapshots.

The two mechanisms have separate purposes:

- **Rollback** is engine-controlled recovery of one failed target inside the running transaction.
- **Undo** is operator-controlled reversal of the completed user command.

If one target rolls back successfully while other targets commit, the batch can still complete. Pressing Undo then reverses the entire user command, including all committed targets in that batch.

If rollback cannot be proved, the batch hard-stops. The operator message states plainly that one Undo reverses the entire batch command, including earlier committed items.

No per-item rollback implementation uses blind `app.undo()`.

#### Hard-stop control flow must close the Undo group normally

`HARD_STOP` is a result state, not an exception used to escape the outer `app.doScript` callback.

The engine catches adapter exceptions inside the transaction, converts them to journaled stage results, marks later targets `NOT_ATTEMPTED` when required, and returns the batch result normally from inside the `UndoModes.ENTIRE_SCRIPT` group.

This is a binding implementation constraint. The operator-facing promise that one Undo reverses the batch depends on allowing the outer undo group to close normally. A host-level failure that prevents ExtendScript from returning control is outside this guarantee, but no ordinary `core/mutate` hard-stop path intentionally throws through the `doScript` boundary.

#### Per-target flow

```text
LOCATOR
   |
RESOLVE
   +-- fail before mutate invoked --> SKIPPED / RESOLVE_FAILED / continue
   |
PRECHECK
   +-- decline --> SKIPPED / PRECHECK_DECLINED / continue
   +-- throw   --> SKIPPED / PRECHECK_ERROR / continue
   |
SNAPSHOT
   +-- throw   --> SKIPPED / SNAPSHOT_ERROR / continue
   |
ROLLBACK-READINESS CHECK
   +-- not ready --> REFUSED / ROLLBACK_NOT_READY / continue
   |
DECLARE DIGEST COVERAGE
   |
CAPTURE PRE-MUTATION KEYED DIGEST
   +-- throw --> SKIPPED / DIGEST_ERROR / continue
   +-- key mismatch --> HALTED / ADAPTER_CONTRACT_MISMATCH
   |
MUTATE INVOKED
   |
RE-ACQUIRE FOR VERIFY
   +-- fail --> HARD_STOP
   |
VERIFY BY READ-BACK
   +-- pass --> COMMITTED
   |
   +-- mutate throws or verify fails
          |
       ROLLBACK FROM SNAPSHOT
          |
       RE-ACQUIRE TARGET
          |
       POST-ROLLBACK KEYED DIGEST
          |
          +-- digest matches --> ROLLED_BACK / continue
          |
          +-- rollback throws, target cannot be resolved,
              digest capture fails, key set mismatches,
              or digest differs --> HARD_STOP
                                      |
                                      +-- halt batch
                                      +-- remaining targets NOT_ATTEMPTED
                                      +-- return normally from doScript
```

#### Required item and batch states

Every requested target ends in exactly one item state:

| State | Meaning |
|---|---|
| `COMMITTED` | Mutation applied and read-back verification passed. |
| `SKIPPED` | No mutation was attempted because the target no longer resolved, precheck declined, precheck errored, snapshot capture errored, or pre-mutation digest capture errored. The document is unchanged for that target. |
| `REFUSED` | The target was eligible for mutation, but a safety requirement such as rollback readiness was not satisfied. The document is unchanged for that target and the refusal is surfaced to the operator. |
| `ROLLED_BACK` | Mutation was attempted, restoration ran, and the independent post-rollback digest matched the pre-mutation digest across the adapter's declared digest coverage. |
| `HARD_STOP` | Mutation may have occurred and restoration failed, the post-mutation target could not be re-acquired, or restoration could not be proved across the declared digest coverage. State for that item is uncertain within the bounds of the transaction contract. |
| `NOT_ATTEMPTED` | The batch halted before this target was reached. |

A mutation batch ends in exactly one batch state:

- `COMPLETE`
- `HALTED`

The journal records `reasonCode` and `failureStage` separately from the final state. Examples include `RESOLVE_FAILED`, `PRECHECK_DECLINED`, `PRECHECK_ERROR`, `SNAPSHOT_ERROR`, `DIGEST_ERROR`, `ROLLBACK_NOT_READY`, `ADAPTER_CONTRACT_MISMATCH`, `MUTATE_ERROR`, `VERIFY_FAILED`, `VERIFY_ERROR`, `ROLLBACK_ERROR`, and `ROLLBACK_DIGEST_MISMATCH`.

`HARD_STOP` always halts the batch.

#### Read-back verification is required

`verify()` re-acquires the target and reads the changed state from the document. It never infers success from the absence of an exception or from the value that was written.

A verification result of false or mismatch records `VERIFY_FAILED`. An exception raised while executing the verification logic records `VERIFY_ERROR`. Both enter the rollback path, but the journal preserves the distinction between a mutation that did not verify and verification code that failed to execute.

This closes two existing silent-success paths. NormalFix can currently report "Could not verify" after leaving a character-style assignment in place, and DocStats `setCustomAltText` can return success after `customAltText` is written even when `altTextSourceType` did not change as required.

#### Bounded rollback guarantee

Manual rollback restores captured properties and proves the result against the adapter's independently derived, declared digest coverage. That guarantee is intentionally bounded.

An InDesign mutation can also trigger recomposition, reflow, overset changes, nested or GREP style application, anchored-object movement, or other composed-state effects. Restoring captured properties does not by itself prove that the whole document is bit-for-bit identical to its earlier state.

Accordingly, `ROLLED_BACK` means:

> The adapter restored the captured state and the independent rollback digest matched its pre-mutation value across the adapter's declared digest coverage.

The adapter documentation and journal identify that coverage. Properties and composed-state effects outside it are outside the proof.

The outer InDesign Undo remains the full-command backstop. The real-DOM canary verifies Undo against a separately declared canary-document digest rather than making an undefined full-document equivalence claim.

#### Dry-run mode

`core/mutate` supports a dry-run execution mode for adapters that can plan safely without writing.

Dry run executes only the planning stages: deterministic ordering, target resolution, precheck, snapshot/readiness assessment, digest-coverage declaration, and pre-mutation digest/key validation. It must not invoke `mutate()`, `verify()`, or `rollback()`.

Dry-run output uses planning results rather than the mutation final-state taxonomy. The journal records `executionMode: DRY_RUN` and planning outcomes only. No record may state `mutationAttempted: true`, `rollbackAttempted: true`, `COMMITTED`, `ROLLED_BACK`, or `HARD_STOP`.

A dry-run target that reveals a pre-mutation condition which would prevent safe live execution reports that risk as a planning finding. It does not enter live rollback handling. Dry run does not claim to predict failures that can only be discovered after a real write.

The canary contains two binding dry-run cases: one batch that would otherwise commit, proving zero mutation and zero mutation journal records; and one batch containing a target with a planning-visible condition that would halt live execution, such as an adapter digest-key mismatch, proving that dry run reports the risk without invoking mutation, verification, or rollback.

#### Transaction journal

Every transaction produces a journal entry per requested target. The shared fields are:

```text
batch ID
processing ordinal
target locator
adapter identity/version
last conformance version
last conformance date
digest coverage declaration
resolve result
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
reason code
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
refused
rolled back
hard stops
not attempted
batch state
further mutations aborted
```

#### Minimal durable journal writer

`core/mutate` owns a minimal durable journal writer from its first adoption. It does not wait for `core/report`.

The writer is intentionally narrow: UTF-8, line-oriented text with escaped tabs, carriage returns, line feeds, and backslashes. It writes a versioned header, one event record per line, and a final batch record. This avoids a dependency on a later reporting module or on optional serialization facilities.

The writer flushes:

- after the batch header is created,
- after every `HARD_STOP` record,
- after the final batch record.

Normal completion also closes the file cleanly. A writer failure is recorded in memory and surfaced in the batch result.

If the writer cannot initialize before target processing begins, the batch ends `HALTED` with `batchReason` `JOURNAL_UNAVAILABLE`; no mutation is attempted and every requested target ends `NOT_ATTEMPTED`. This is a batch preflight failure rather than an item-level `REFUSED` state.

If the writer fails after mutation processing has begun, journal failure does not abort the current target mid-proof. The engine completes verification or, when verification fails, completes rollback and rollback verification for that target in memory. The current target then takes its proven final item state. Only after that proof completes does the batch end `HALTED` with `batchReason` `JOURNAL_FAILURE`; all later targets end `NOT_ATTEMPTED`, and the operator message states that durable journaling was lost.

If the engine cannot complete verification or rollback proof for the current target, that target ends `HARD_STOP` for the document-state reason. Journal loss by itself never rewrites a proven `COMMITTED` or `ROLLED_BACK` item as `HARD_STOP`.

`core/report` may later ingest or replace the presentation layer around these records, but the mutation engine's minimal durability path remains shared and portable.

#### Real-DOM canary document digest

T10 uses a small, purpose-built InDesign canary document and a declared `canaryDocumentDigest()` coverage list. This is a test-fixture proof, not a production full-document digest requirement.

The real-DOM canary declares every fixture dimension it expects Undo to restore. At minimum, the fixture digest covers all stories in the canary document, text contents, paragraph-style assignments, character-style runs, relevant local formatting/override signatures, and any additional fixture state deliberately changed by the test.

The digest is captured before the batch and after one InDesign Undo. T10 passes only when those digests match across the declared canary coverage.

Any state omitted from the canary-document coverage is outside T10's claim. The canary remains small enough that broad fixture coverage is practical and reviewable.

#### Mutation canary

The safety mechanism is proved independently before production integration.

| ID | Case | Expected result |
|---|---|---|
| T01 | Precheck passes, mutate succeeds, verify passes | `COMMITTED`; rollback never invoked |
| T02 | Precheck declines | `SKIPPED`; target unchanged; decline distinguished from error |
| T03 | Mutate throws after mutation is invoked | Rollback runs; `ROLLED_BACK` if restoration proves clean |
| T04 | Mutate succeeds, verify fails | Rollback runs; `ROLLED_BACK` if restoration proves clean |
| T05 | Rollback throws | `HARD_STOP`; batch `HALTED`; engine returns normally from `doScript` |
| T06 | Rollback reports success but post-rollback digest differs | `HARD_STOP`; batch `HALTED` |
| T07 | Mutation changes a property absent from snapshot but present in declared digest coverage | Independent digest detects residue; `HARD_STOP` |
| T08 | Mixed batch: several commit and one rolls back successfully | Committed targets remain changed, failed target restored, batch `COMPLETE` |
| T09 | Hard stop at item 4 of 10 | Items 5 through 10 are deterministically `NOT_ATTEMPTED`; batch `HALTED` |
| T10 | Full real-DOM canary batch followed by one InDesign Undo | Canary-document digest matches pre-batch digest across declared fixture coverage |
| T11 | Mutation invalidates the original target reference | Re-acquisition succeeds and verification still runs |
| T12 | Re-run against already-correct targets | Targets decline through precheck; no second mutation |
| T13 | Locator is stale before mutation begins | `SKIPPED` with `RESOLVE_FAILED`; batch continues |
| T14 | Precheck throws | `SKIPPED` with `PRECHECK_ERROR`; target unchanged; batch continues |
| T15 | Target is eligible but snapshot reports rollback not ready | `REFUSED`; target unchanged; refusal counted and surfaced |
| T16 | Durable journal cannot initialize before target processing | Batch `HALTED` with `JOURNAL_UNAVAILABLE`; all targets `NOT_ATTEMPTED`; no mutation occurs |
| T17 | Durable journal fails after mutation processing begins | Current target completes verification or rollback proof before batch halt; later targets `NOT_ATTEMPTED` |
| T18 | `rollbackDigest()` key set differs from `digestCoverage()` | Batch `HALTED` with `ADAPTER_CONTRACT_MISMATCH`; current and later targets `NOT_ATTEMPTED`; earlier proven item states preserved |
| T19 | Dry run over a batch that would otherwise commit | Planning results only; zero mutation, verify, rollback calls, and zero document change |
| T20 | Dry run includes a target with a planning-visible condition that would halt live execution, such as digest-key mismatch | Risk reported as planning output; no mutation, verification, or rollback handling |
| T21 | `snapshot()` throws before mutation | `SKIPPED` with `SNAPSHOT_ERROR`; target unchanged; batch continues |
| T22 | Pre-mutation digest capture throws | `SKIPPED` with `DIGEST_ERROR`; target unchanged; batch continues |
| T23 | Mutation changes a property absent from both snapshot and declared digest coverage, then rollback is forced | `ROLLED_BACK` may pass while residue remains; test demonstrates the explicit proof boundary |
| T24 | `compareLocators()` throws during batch preflight | Batch `HALTED` with `ADAPTER_CONTRACT_MISMATCH`; all targets `NOT_ATTEMPTED`; no mutation occurs |
| T25 | Comparator produces inconsistent ordering under validation | Batch `HALTED` with `ADAPTER_CONTRACT_MISMATCH`; all targets `NOT_ATTEMPTED`; no mutation occurs |
| T26 | `verify()` throws after mutation | `VERIFY_ERROR`; rollback runs and reaches `ROLLED_BACK` if restoration proves clean |
| T27 | `verify()` returns false or mismatch after mutation | `VERIFY_FAILED`; rollback runs and reaches `ROLLED_BACK` if restoration proves clean |

The canary has two tiers:

- **Synthetic tier:** T01 through T09 and T12 through T27. These exercise pure transaction logic with deterministic synthetic targets and require no open InDesign document.
- **Real-DOM tier:** T10 and T11. These exercise InDesign Undo integrity and object invalidation against a real document because those behaviors cannot be proved by synthetic objects.

T07 proves that rollback verification can detect residue intentionally excluded from restoration but included in declared proof coverage. T18 proves the declared coverage cannot drift from the keyed digest implementation. T19 and T20 prove dry-run suppression. T21 and T22 pin the remaining pre-mutation exception paths. T23 deliberately passes with out-of-coverage residue so the bounded nature of `ROLLED_BACK` is executable rather than merely documented.

T09 also verifies deterministic ordering. T13 pins the pre-mutation resolve-failure rule. T14 distinguishes a precheck exception from a normal decline. T15 ensures a safety refusal cannot disappear into the `SKIPPED` count. T16 and T17 pin durable-journal failure semantics without conflating reporting loss with uncertain document state. T24 and T25 guard comparator preflight. T26 and T27 distinguish verification-code failure from a legitimate verification mismatch.

#### Adapter conformance gate

The engine can enforce transaction behavior, but snapshot fidelity, locator stability, digest provenance, rollback implementation, and precheck correctness are adapter-owned. Every production adapter therefore passes a real-DOM conformance suite before adoption.

Each adapter declares:

```text
adapterVersion
lastConformanceVersion
lastConformanceDate
```

Before any live mutation batch begins, `core/mutate` requires:

```text
adapterVersion == lastConformanceVersion
```

A mismatch ends the batch `HALTED` with `batchReason` `ADAPTER_CONFORMANCE_STALE`; no mutation occurs and all requested targets end `NOT_ATTEMPTED`.

The mutation journal records the adapter version, last conformance version, and last conformance date so a later report can prove that the exact running adapter version had a current conformance pass.

Any change to locator behavior, snapshot contents, rollback behavior, digest coverage, digest computation, precheck behavior, or mutation behavior requires an adapter version increment and a new conformance pass before live mutation is permitted.

The minimum conformance suite is:

| ID | Case | Required proof |
|---|---|---|
| `AC01` | Locator stability | A benign document edit occurs between discovery and execution; the locator re-resolves the intended live target correctly. |
| `AC02` | Digest provenance | Each declared digest dimension is changed directly in the live DOM where expressible; the corresponding digest key changes. Digest values must come from document reads rather than snapshot reuse. |
| `AC03` | Live rollback | Verification failure is injected only to enter the rollback path. The production adapter's real snapshot, rollback, target re-resolution, digest capture, and rollback verification implementations run unchanged and restore the live target across declared coverage. |
| `AC04` | Idempotent precheck | An already-correct live target is declined by precheck and no mutation occurs. |
| `AC05` | Inapplicable dimension | A live target lacks state for a declared digest dimension; the adapter still emits that key as `Mutate.NOT_APPLICABLE` from the dimension read. Creating state in that dimension changes the key from the sentinel to a value. |

AC03 must not substitute a simulated rollback implementation. The injected verification failure is only the trigger that enters the production rollback path.

Adapter conformance is a release gate, not a one-time certification. A conformance result applies only to the exact `adapterVersion` that passed it.

#### Comparator preflight

`compareLocators()` runs before target processing and is an adapter contract surface. The engine guards comparator execution and validates deterministic output before opening the mutation path.

A comparator exception, invalid comparison result, or detected inconsistent ordering ends the batch `HALTED` with `batchReason` `ADAPTER_CONTRACT_MISMATCH`; no mutation occurs and all requested targets end `NOT_ATTEMPTED`.

Comparator validation must at minimum confirm that the same copied locator set sorted repeatedly under the comparator yields the same serialized locator order. This does not constitute a mathematical proof of comparator transitivity, but it makes nondeterminism observable and keeps comparator failure in batch preflight rather than inside document mutation.

#### Adoption order within `core/mutate`

1. **FROZEN 2026-08-19:** portable `core/mutate` v1 contract.
2. Build and pass the synthetic mutation canary, including T18 through T27.
3. Build and pass the real-DOM mutation canary.
4. Implement the NormalFix mutation adapter.
5. Publish NormalFix snapshot coverage and digest coverage as part of the adapter review.
6. Run and pass NormalFix adapter conformance AC01 through AC05; record `adapterVersion`, `lastConformanceVersion`, and `lastConformanceDate`.
7. Verify NormalFix repair, refusal, rollback, hard-stop, durable journal, deterministic ordering, and one-step Undo behavior.
8. Integrate DocStats, beginning with `relinkAsset`, under the same adapter-conformance gate.
9. Extend the same contract to remaining mutation paths without introducing tool-specific transaction forks.

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
