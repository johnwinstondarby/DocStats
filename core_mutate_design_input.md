# core/mutate — design input

Input to the contract, not the contract. Pilgrim owns the specification; this
records the design decisions that are easy to get wrong and hard to change
afterward, plus a proposed canary case list.

---

## 1. Batch undo and per-item rollback pull against each other

Both are wanted. They cannot both be granular.

`app.doScript` with `UndoModes.ENTIRE_SCRIPT` produces exactly one undo entry for
everything inside it. Nested `doScript` calls are absorbed by the outer one, so
per-item undo entries inside a batch-level group are not available. The choice is
real:

- **One entry per batch.** Clean operator experience. But if item 7 of 30 fails
  and is rolled back, pressing Undo now reverts all 30.
- **One entry per item.** Granular, but a 30-item repair leaves 30 undo steps.

**Recommendation: one entry per batch, with manual rollback as the in-transaction
mechanism and InDesign's undo as the backstop.** When a rollback cannot be
verified, the hard-stop message tells the operator that one Undo reverts the
entire batch. That is coherent, and it is the only way the backstop stays
meaningful.

State the consequence plainly in the contract rather than leaving it implied.

## 2. Manual rollback restores captured properties, not document state

This is the honest limit of snapshot-and-restore and it should be written down
rather than discovered.

Applying a paragraph style can produce effects beyond the properties captured:
recomposition, reflow, overset changes, anchored-object repositioning, and
reapplication of nested or GREP styles defined in the style. Restoring the
captured properties does not necessarily restore composed state.

For NormalFix's style-only changes this is unlikely to matter. For a portable
component it will eventually matter, and a contract that implies rollback is
complete will be believed.

## 3. Snapshot completeness cannot be verified against the snapshot

The most important item here.

`snapshot()` is only as good as its property list, and an uncaptured property is
silently unrestored. This is the same defect shape as the StyleFix fingerprint:
a property that was never read cannot be found missing.

If `verifyRollback()` compares the same properties that `snapshot()` captured,
it proves nothing about the ones neither of them looked at. It is circular, and
it will pass.

**Requirement: `verifyRollback()` compares a broad independent digest, not the
snapshot's property list.** Capture a wide-net signature of the target before the
transaction and again after rollback, and require them to match. The snapshot
exists to *restore*; the digest exists to *prove restoration*. They must be
derived separately, for the same reason the canary census must not share
traversal code with the scanner.

## 4. Object references may not survive mutation

Text objects can be invalidated by recomposition. If `mutate()` invalidates the
reference, `verify()` and `rollback()` then operate on a dead object, and every
guard reports a benign failure while the document stays changed.

**Requirement: targets are identified by stable coordinates and re-acquired at
each stage,** not held as live references across the transaction. For text, story
ID plus character offset range. The contract should also state that targets are
resolved per item at the moment of use rather than resolved for the whole batch
up front, because an earlier item that changes text length would shift the
offsets of every later one. NormalFix's changes do not alter length. A future
adopter's might.

## 5. Every item ends in exactly one named state

The current NormalFix defect exists because "Could not verify" was a report
string rather than a state with defined document consequences.

| State | Meaning |
|---|---|
| `COMMITTED` | Mutation applied and verified. |
| `SKIPPED` | Precheck declined. Document untouched. |
| `ROLLED_BACK` | Mutation applied, verification failed, restoration verified. |
| `HARD_STOP` | Restoration failed or could not be verified. Document state unknown for this item. |
| `NOT_ATTEMPTED` | Batch halted before this item was reached. |

Batch ends in `COMPLETE` or `HALTED`. No other outcome exists, and no item may
end without one of these five.

**`HARD_STOP` halts the batch.** Continuing would bury an unrecoverable item
deeper under subsequent changes and make the undo backstop less usable.

## 6. Canary case list

Pilgrim's design injects mutation, verification, and rollback failures, which is
the right instinct. Proposed enumeration:

| ID | Case | Expected |
|---|---|---|
| T01 | Precheck passes, mutate succeeds, verify passes | `COMMITTED`, rollback never invoked |
| T02 | Precheck declines | `SKIPPED`, document unchanged |
| T03 | Mutate throws | `ROLLED_BACK` |
| T04 | Mutate succeeds, verify fails | `ROLLED_BACK` |
| T05 | Rollback throws | `HARD_STOP`, batch halts |
| T06 | Rollback returns success, `verifyRollback` fails | `HARD_STOP`, batch halts |
| T07 | Mutate changes a property absent from the snapshot | Must FAIL via the independent digest |
| T08 | Mixed batch: several commit, one rolls back | Committed items intact, rolled-back item restored, batch `COMPLETE` |
| T09 | Hard stop at item 4 of 10 | Items 5–10 are `NOT_ATTEMPTED`, batch `HALTED` |
| T10 | Full batch, then one Undo | Document matches pre-batch digest |
| T11 | Mutation invalidates the target reference | Re-acquisition succeeds, verify still runs |
| T12 | Re-run against already-correct targets | All `SKIPPED` via precheck, no second mutation |

**T06 is the subtle one.** A rollback that claims success while proof says
otherwise is the exact shape of the three report-does-not-match-artifact defects
already on record in this project.

**T07 is the one most likely to be omitted**, and it is what proves
`verifyRollback` is not circular. If T07 passes when it should fail, the whole
verification layer is decorative.

## 7. The canary needs two tiers

T01 through T09 and T12 are pure transaction logic and run against synthetic
targets with no document open. Fast, deterministic, and suitable for a
pre-commit check.

T10 and T11 require a real document and a real DOM, because undo integrity and
object invalidation cannot be simulated by a fake object that behaves as
instructed.

Splitting them keeps the fast tier fast and makes it obvious which cases were
actually exercised on a given run.

## 8. Two additions worth considering

**Dry run.** Run precheck, snapshot, and the verification plan without mutating,
and report what would happen. Cheap, and a reasonable default for a tool with a
partial-mutation history.

**Journal durability.** An in-memory journal is lost if InDesign hangs mid-batch,
which is precisely when it is most wanted. Flush to disk on hard stop and on
batch completion, with the batch label, per-item states, and timestamps.
