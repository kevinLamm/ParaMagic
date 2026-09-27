# Stack deletion and child handling

## Behavior

- The Stack delete button and Stack-tree Delete/Backspace delete a Stack without children immediately.
- A Stack with children offers Cancel, Move children out, or Delete children directly. There is no preliminary confirmation.
- Move children out promotes the direct children to the deleted Stack's parent, at its sibling position. Their descendants, IDs, coordinate frames, geometry, dimensions, and internal constraints remain intact.
- Delete children removes the complete subtree and its owned records, including inactive or hidden Stack contents and locked images.
- Cancelling the child-choice dialog leaves the drawing unchanged. Deletion and promotion are one history operation.

## Cause of the previous orphaned geometry

Stack removal previously selected the records through the interactive selection filter before deleting them. That filter excluded inactive/hidden child records. Their solver data and Stack definitions were removed anyway, leaving records that normalization reassigned to the first Stack.

Explicit record deletion now operates on record IDs directly. Normal selection deletion still respects image locks and table-row deletion. Stack deletion requests removal of every owned record, regardless of selection or image lock status.

StackDeletion.js owns hierarchy planning and deletion orchestration. StackDeleteDialog.js owns the confirmation flow. The canvas coordinator only wires these modules to its shared record, history, and solver services.

## Verification

### Follow-up: remove the preliminary confirmation

The user requested immediate deletion because Undo can restore accidental deletions. Only the initial confirmation was removed; the child-choice flow and deletion implementation remain in place.

- All 68 focused Stack tests passed (`direct-delete-tests.txt`).
- Browser checks verified immediate leaf deletion without a modal, restoration with one Undo, direct display of the child-choice modal, cancellation, both child-handling outcomes, and Undo after promotion.
- The isolated verification server was configured to exclude core source entry points from dependency optimization so it serves the edited modules rather than its previously cached bundle.

### Initial implementation

The changes were tested in an isolated source copy on localhost:5174 before installation. No user drawing was loaded or changed by these checks.

- `npm test`: 1,281 passed, zero failures, skips, or cancellations.
- `npm run build`: passed.
- `npm run build:pages`: passed (existing bundle-size warning).
- Installed source hashes match the verified copy; all 69 focused Stack tests passed again after installation.
- New automated cases cover root/nested promotion, preserved frames and IDs, full subtree deletion, solver constraint ownership, cancellation at either step, leaf deletion, abort, and protected Stack handling.

Rendered browser workflow used the actual application and Stack toolbar. The fixture contains a first Stack, a source Stack with a locked image and constrained line, two children (one hidden), a grandchild, a radius dimension, and an unrelated sibling.

| Browser action | Observed result |
| --- | --- |
| Delete button, Cancel | First confirmation rendered; drawing unchanged |
| Confirm, then Cancel | Child-choice dialog rendered; drawing unchanged |
| Confirm, Move children out | Source geometry removed; child geometry rendered in place; children promoted; grandchild hierarchy and child constraints/dimensions retained |
| Undo, Redo after moving children | One Undo restored geometry, constraints, and hierarchy; Redo reapplied promotion |
| Serialized reload after moving children | Geometry ownership and hierarchy preserved |
| Confirm, Delete children | Entire subtree and its records removed; no geometry reassigned to first Stack |
| Undo, Redo after deleting children | One Undo restored complete subtree; Redo removed it again |
| Serialized reload after deleting children | Deleted geometry remained absent |
| Delete a Stack with no children | One confirmation only; Stack and geometry removed |

The browser harness additionally compares surviving entities exactly, checks removed IDs in both drawing data and canvas DOM, and checks surviving constraints and driving dimensions. Screenshots were visually reviewed for both dialogs and both deletion outcomes.

The reproducible harness and test/build logs are stored alongside this report. To rerun the harness with the app's Vite server, copy its HTML and JavaScript files to the repository root and open `/stack-delete-check.html` in a disposable browser tab.
