# ParaMagic Stack Tree and Expression-Driven Activation Upgrade Plan

## Objective

Evolve Stacks from a flat, thumbnail-based layer list into ParaMagic's permanent hierarchical drawing-composition system.

The upgraded system must support:

- parent Stacks containing child Stacks;
- permanent tree presentation in a docked left sidebar;
- selection, activation, expansion, reordering, and reparenting;
- recursive subtree deletion and subtree export;
- expression-driven Stack enablement, including dependencies on driven dimensions;
- incremental solve/activation stabilization without restoring drawing-global solving;
- preservation of stable Stack, dimension, constraint, and relationship identities;
- deterministic save, load, insert, clipboard, history, and migration behavior.

The Stack tree is both an organizational hierarchy and a runtime composition graph. Parent/child containment alone must not connect numerical solver components. Only explicit dimensions, constraints, expressions, and extension-owned relationships create solve dependencies.

The persistent-schema, insertion, clipboard, relationship, and history phases in this plan depend on `GENERIC_UUID_IDENTITY_MIGRATION_PLAN.md`. The Stack tree must use the generic raw-UUID identity model from its first live version and must not introduce another Stack-specific ID generator.

## Agreed product decisions

These decisions are requirements for the upgrade.

- Tree nodes have an explicit kind: ordinary `stack` nodes are drawable, while imported `drawing` container nodes are non-drawable and only contain Stack subtrees.
- The current drawing is represented by a permanent virtual root row named after the drawing. It is not a persisted Stack and cannot own geometry.
- Every live Stack has a globally unique opaque ID generated independently of its name.
- Every object, dimension, constraint, and extension-owned relationship has exactly one direct owner Stack.
- A parent derives ownership of its descendants as a subtree; records are never duplicated into ancestors.
- Stack names remain drawing-global, case-insensitively unique, and use the existing `(1)`, `(2)` suffix convention.
- Dimension names remain local to their direct owner Stack and continue to use `dN@Stack Name` for cross-Stack references.
- Reparenting or reordering a Stack does not change its ID, name, direct record ownership, expressions, or solver relationships.
- Deleting a parent recursively deletes all descendant Stacks and every record directly owned by any Stack in that subtree.
- Exporting a parent exports its complete descendant subtree.
- Enable/Disable is distinct from visibility and deletion.
- A disabled Stack remains stored but is absent from the active drawing, solver, canvas interaction, and geometric export.
- Stack enablement combines a stored manual `enabled` switch with an optional expression. Manual enablement forces the Stack on; otherwise the expression controls it.
- Enable expressions may reference global Parameters, Controls, document variables, driving dimensions, and driven dimensions.
- Driven-dimension activation dependencies participate in a repeated solve/evaluate/activate loop until both geometry and Stack activation are stable.
- Static activation cycles and runtime activation oscillation must be detected and reported rather than iterated indefinitely.
- Disabling a parent makes its complete subtree effectively disabled while preserving every child's own enable expression.
- The Stack tree is permanently visible below the application header in a docked left sidebar.
- The tree uses compact rows rather than geometry thumbnails.
- Active and enabled are independent. A disabled Stack may be active so its design state remains reachable; activation never enables it.
- Double-click toggles an ordinary Stack active or inactive, and `activeStackId: null` is a valid persistent state. There is no automatic active fallback.
- The drawing-root toolbar contains only Add Child Stack and Insert Stack or Drawing.
- A Stack export inserts directly at the drawing root. A full drawing inserts as a UUID-backed non-drawable drawing container with visibility, rename, Save As, delete, and enable controls.

## Terminology and state model

The implementation must distinguish the following concepts.

### Present

A Stack is present when its persistent Stack record exists in the drawing. Disabled Stacks remain present. Insert creates presence; delete removes it.

### Locally enabled

A Stack is locally enabled when its manual `enabled` switch is on, or when the switch is off and its `enabledExpression` evaluates to a truthy Boolean value without an activation error. A blank expression evaluates to `FALSE`.

### Effectively enabled

A Stack is effectively enabled only when it is locally enabled and every ancestor is effectively enabled.

```text
effectiveEnabled(stack) =
  (manualEnabled(stack) || evaluate(enabledExpression(stack) || FALSE))
  && effectiveEnabled(parent(stack))
```

Top-level Stacks have no parent gate.

### Visible

Visibility remains a presentation property. Hiding an enabled Stack must not remove it from solving. This plan does not change existing geometric-export visibility rules; effective disablement always excludes geometry from geometric export.

### Selected Stack

Tree selection is a UI concept. A disabled Stack may remain selected so it can be renamed, moved, exported, deleted, inspected, or re-enabled.

### Active Stack

The active Stack is the drawable editing and ownership context. It may be disabled; disabled status still excludes its records from rendering, relationships, and solving. A drawing container can never be active. When no Stack is active, drawing-creation tools are unavailable.

### Dormant relationship

A dormant relationship is stored relationship intent whose required Stack participants are not currently available. Missing inserted Stacks use serialized dormant templates. Present-but-disabled Stacks suppress relationships at runtime without rewriting the serialized relationship into a template.

## Canonical persistent schema

Bump the Stack architecture and extension versions to `4`.

```js
{
  version: 4,
  activeStackId: null,
  stacks: [
    {
      id: "c42fb30e-8c3a-43d8-8354-c0aac5b21b67",
      kind: "stack",
      sourceStackId: null,
      parentStackId: null,
      order: 0,
      name: "Bodice",
      visible: true,
      enabled: true,
      enabledExpression: "",
      removable: true
    },
    {
      id: "a29abcc3-e7e4-4b9f-84f7-1fc773831e20",
      kind: "stack",
      sourceStackId: null,
      parentStackId: "c42fb30e-8c3a-43d8-8354-c0aac5b21b67",
      order: 0,
      name: "Front",
      visible: true,
      enabled: false,
      enabledExpression: "d1@Bodice >= 1200 mm",
      removable: true
    }
  ]
}
```

Rules:

- `id` is an opaque, collision-resistant UUID generated by one core Stack-ID factory. It is never derived from, encoded with, or synchronized to the Stack name.
- `kind` is `stack` for drawable ownership contexts and `drawing` for imported non-drawable containers.
- A `drawing` node records the source drawing UUID as lineage-only `sourceDrawingId` and can never be assigned to `activeStackId` or a drawing-owned record.
- A live Stack ID is globally unique across drawings and Stack instances, not merely unique within one drawing state.
- Native save/load preserves a Stack's live ID. Rename, reorder, reparent, enable, disable, hide, and show never change it.
- Duplicate, paste-as-Stack, and drawing/subtree insertion always allocate a new live ID for every created Stack, even when an incoming ID does not collide in the destination.
- `sourceStackId` is optional lineage metadata only. It is never a live identity, ownership key, uniqueness exemption, or reason to reuse an incoming ID.
- `parentStackId` is `null` for top-level Stacks.
- A parent ID must reference another Stack in the same state.
- A Stack cannot parent itself or one of its ancestors.
- `order` is normalized to a contiguous sibling order within each parent.
- `enabled` defaults to `true`.
- `enabledExpression` defaults to blank, and blank evaluates to `FALSE` when manual enablement is off.
- Changing `enabled` never erases or rewrites `enabledExpression`.
- Effective enablement, activation errors, expansion, selection, and computed dependency edges are runtime state and are not serialized as authoritative drawing data.
- Expanded/collapsed UI state is not drawing history and must not affect drawing serialization.
- Inserted subtrees receive new live IDs while preserving `sourceStackId` for relationship reactivation.
- The existing non-removable Default Stack remains a top-level drawable Stack during migration. It is not an artificial tree root.
- The permanent drawing row is a virtual UI root backed by the drawing UUID and drawing name; top-level persisted nodes are displayed beneath it.

## Core invariants

The core must reject or normalize any state that violates these invariants before the solver or UI receives it.

1. Stack IDs are non-empty opaque UUIDs, globally unique for every live Stack instance, and independent of Stack names.
2. Stack names are globally unique under the rules in `NamingSystem.js`.
3. Parent references resolve within the same Stack state.
4. The parent graph is acyclic.
5. Sibling order is deterministic.
6. Every drawing-owned record resolves to one present direct owner Stack.
7. `participantStackIds` contains actual non-owner participant IDs only; ancestors are not inserted implicitly.
8. A disabled or ancestor-disabled Stack contributes no active variables, constraints, dimensions, hit targets, or rendered records.
9. Parent/child containment does not itself add a solver-participation edge.
10. A Stack activation expression resolves symbols through the same naming and expression rules used everywhere else.
11. A driven dimension is available to an activation expression only while its owner Stack is effectively enabled and its value has been refreshed from accepted solved geometry.
12. Failed activation stabilization cannot partially commit geometry or effective Stack state.

## Proposed module ownership

### `StackArchitecture.js`

Own the persistent tree schema and all pure hierarchy operations.

Add or upgrade APIs for:

- one canonical collision-resistant `createStackId()` factory used by creation, duplication, paste-as-Stack, and insertion;
- normalization and version-4 migration;
- indexed lookup by Stack ID and parent ID;
- ancestor, descendant, and subtree closure;
- sibling-order normalization;
- reparent validation and cycle rejection;
- nullable active-Stack validation;
- subtree record closure for delete and export;
- migration of flat version-2 Stacks to top-level version-4 Stack nodes;
- validation diagnostics that name the offending Stack IDs and names.

Suggested pure APIs:

```js
normalizeStackArchitectureState(value)
createStackTreeIndex(state)
ancestorStackIds(state, stackId)
descendantStackIds(state, stackId)
subtreeStackIds(state, stackId)
validateStackReparent(state, stackId, parentStackId)
reparentStack(state, stackId, parentStackId, siblingIndex)
reorderStack(state, stackId, siblingIndex)
nextActiveStackId(state, unavailableStackIds, previousActiveStackId)
```

### `NamingSystem.js`

Remain the only naming authority.

- Keep Stack names globally unique; do not introduce path-based expression names.
- Keep `dN@Stack Name` unchanged.
- Rewrite qualified references after inserted subtree name suffixing.
- Reserve names belonging to disabled Stacks.
- Provide exact-symbol rewriting for Stack enable expressions.

### `StackSystem.js`

Own live Stack tree state and drawing-facing mutations.

- Replace flat movement methods with sibling reorder and reparent operations.
- Add child and sibling creation methods.
- Separate selected Stack from active Stack.
- Permit activation of disabled drawable Stacks while rejecting drawing-container activation.
- Permit explicit deactivation with `setActiveStack(null)` and never choose a fallback automatically.
- Derive effective visibility and effective enablement through ancestry.
- Expose indexed queries without scanning `state.stacks` for every record.
- Emit narrow reasons and affected Stack/subtree IDs.
- Keep add, rename, reorder, reparent, visibility, enable-expression edit, and delete as explicit history-aware transactions.
- Remove thumbnail-specific panel ownership after `StackTreePanel.js` is live.

Suggested runtime APIs:

```js
addStack({ name, parentStackId, siblingIndex })
addChildStack(parentStackId, name)
addSiblingStack(stackId, name)
setSelectedStack(stackId)
setActiveStack(stackId)
setStackVisible(stackId, visible)
setStackEnabledExpression(stackId, expression)
setStackEnabled(stackId, enabled)
reparentStack(stackId, parentStackId, siblingIndex)
reorderStack(stackId, siblingIndex)
removeStackSubtree(stackId)
isStackEffectivelyEnabled(stackId)
isStackEffectivelyVisible(stackId)
```

### New `StackActivationSystem.js`

Own Stack enable-expression compilation, dependency tracking, evaluation, and activation diagnostics. It must remain independent of DOM presentation.

Responsibilities:

- compile each `enabledExpression` through the existing expression parser;
- resolve symbols to stable Parameter, Control, document-variable, or dimension IDs;
- create reverse indexes from referenced IDs to dependent Stack IDs;
- record source Stack dependencies for dimension references;
- classify dependencies as immediately evaluable, awaiting a driven solve, unavailable, cyclic, or invalid;
- reevaluate only dirty activation expressions;
- calculate local and effective enabled states;
- detect static activation dependency cycles;
- detect repeated runtime activation-state signatures;
- produce structured diagnostics naming Stack names, expressions, and causing dimensions;
- preserve the last accepted activation state when stabilization fails.

Suggested APIs:

```js
createStackActivationSystem(options)
compileStackExpressions(stackState, expressionSymbols)
markActivationDependentsDirty(parameterIds)
evaluateDirtyStackExpressions(context)
effectiveEnabledStackIds(stackState, localStates)
activationDiagnostics()
```

### `solver/StackSolveSystem.js`

Extend existing Stack participation grouping without making hierarchy a solve edge.

- Filter participation graphs to effectively enabled Stacks.
- Accept dirty Stack seeds from geometry, parameter, driven-dimension, and activation changes.
- Solve explicitly connected enabled groups only.
- Exclude disabled subtree variables and constraints from component construction and residual evaluation.
- Return refreshed driven dimension IDs with each Stack solve result.
- Preserve Stack-specific solve diagnostics and aggregate status.

### `SolverController.js` and solver execution facade

- Maintain active indexes by direct owner Stack ID.
- Add and remove complete Stack subtrees from active solver graphs by delta.
- Suppress relationships whose participants are not effectively enabled without deleting their persistent records.
- Refresh driven dimensions only for solved components.
- Return changed driven dimension IDs to the activation system.
- Snapshot affected solve components and prior activation state for atomic rollback.
- Mirror activation commands and results across the worker protocol when the worker becomes authoritative.

### `StackRelationshipSystem.js`

- Continue to own serialized dormant templates for missing inserted Stacks.
- Add runtime availability reconciliation for present-but-disabled participant Stacks.
- Do not delete or serialize a new template merely because a Stack was disabled.
- Reactivate suppressed relationships when all present participants become effectively enabled.
- Apply subtree delete pruning against the full deleted Stack-ID set.
- Apply subtree export closure against all included descendant Stack IDs.

### `ParameterRepository.js`

- Expose stable symbol references and reverse dependents needed by activation expressions.
- Resolve bare `dN` in the context of the Stack whose enable expression is being evaluated.
- Resolve qualified `dN@Stack Name` case-insensitively.
- Report a distinct unavailable-disabled-Stack error rather than `Unknown parameter` when the symbol exists but its owner is disabled.
- Preserve global Parameter and Control behavior.
- Rewrite enable expressions on parameter, dimension, and Stack rename using `NamingSystem.js`.

### `DrawingIO.js`

- Normalize and serialize version-4 hierarchy, tree-node kinds, nullable activation, and enable expressions.
- Export a selected Stack as a complete subtree.
- Include every disabled descendant in native ParaMagic/JSON subtree packages so no design data is lost.
- Exclude effectively disabled records from DXF, SVG, PNG, print, bounds, and measurement output.
- Preserve internal subtree relationships as active.
- Convert relationships crossing outside an exported subtree into dormant portable intent.
- Insert a complete hierarchy with new Stack IDs, remapped parent IDs, normalized sibling order, globally unique names, and rewritten expressions.
- Remove the existing same-ID/`mergeTarget` insertion path. Ordinary insert must never merge with or reuse a destination Stack because an incoming ID happens to match.
- If a future explicit merge command is added, it must be a separate user-invoked operation and cannot redefine either Stack's identity implicitly.
- Keep destination drawing-global Parameters and Controls under the existing merge rules.

### `DrawingClipboard.js` and `StackClipboardSystem.js`

- Preserve direct owner Stack IDs and subtree context when clipboard content includes Stack packages.
- Continue to renumber copied dimensions in the destination Stack.
- Continue to convert source-only local references to qualified references.
- Ensure disabled Stack names remain resolvable and reserved during retargeting.
- Do not make ordinary geometry clipboard operations implicitly copy ancestor Stacks.

### New `StackTreePanel.js`

Own all permanent Stack-tree DOM, accessibility, keyboard, drag/drop, row-toolbar, and expression-editor behavior.

This module replaces the floating thumbnail panel. It must receive narrow callbacks and state snapshots from `StackSystem.js`; it must not own drawing records or solver behavior.

### `infiniteCanvas.js`

Remain orchestration only.

Allowed changes:

- wire Stack state deltas to presentation and solver services;
- route subtree delete/export requests to owning modules;
- route activation stabilization results to record presentation;
- update shared canvas bounds after the docked sidebar changes layout.

Prohibited changes:

- hierarchy algorithms;
- expression parsing;
- activation dependency traversal;
- Stack-tree DOM listeners;
- reparent/drop rules;
- subtree export or deletion algorithms.

### `src/main.js` and `src/styles/app.css`

- Create the permanent workspace split below the existing header.
- Mount `StackTreePanel.js` in a dedicated left sidebar.
- Remove the floating Stack-panel toggle behavior.
- Remove the current Stacks toolbar button because the Stack tree is permanently visible.
- Make the sidebar resizable while remaining docked and visible.
- Ensure the canvas uses its actual resized client bounds for input transforms, Zoom All, overlays, and exports.

## Solve and activation stabilization contract

Expression-driven activation must use an explicit transactional stabilization loop.

### Dependency example

```text
Structure Stack solve
        |
        v
driven d1@Structure
        |
        v
Support Rail enabledExpression
        |
        v
Support Rail effective activation
        |
        v
Support Rail and explicitly connected Stack solves
```

### Stabilization algorithm

For a committed edit, load, insertion, or explicit enable-expression change:

1. Begin one activation/solve transaction.
2. Determine dirty enabled Stack solve groups from the original edit.
3. Solve only those enabled groups.
4. Refresh driven dimensions belonging to changed geometry.
5. Mark activation expressions referencing changed dimensions or Parameters dirty.
6. Evaluate dirty Stack enable expressions in dependency order.
7. Recalculate effective enabled states through ancestry.
8. Delta-remove newly disabled subtrees from active solver and presentation indexes.
9. Delta-add newly enabled subtrees and their currently available relationships.
10. Seed solves for newly enabled or newly reconnected groups.
11. Repeat from step 3 until no geometry, driven value, expression result, or effective activation state is dirty.
12. Commit geometry, driven values, activation state, and one history entry atomically.

This is the implementation of the previously agreed rule to repeat solving until all affected Stack relationships and dimensions are fully stable.

### Static cycle detection

Build an activation dependency graph from dimension-owner Stack to dependent Stack. Reject cycles that require a Stack to become available before the driven value controlling its own availability can exist.

The diagnostic must include every participating Stack and dimension, for example:

```text
Stack activation cycle:
"Support A" depends on d1@Support B,
and "Support B" depends on d2@Support A.
```

### Runtime oscillation detection

Record the effective-enabled Stack-ID set after each activation round. If a non-consecutive state repeats, activation is oscillating.

Example:

```text
Support Rail enabled -> structure shortens below threshold
Support Rail disabled -> structure lengthens above threshold
Support Rail enabled -> repeated state
```

On oscillation:

- stop immediately;
- restore the last accepted geometry, effective activation state, and committed enable expression;
- retain the rejected expression text as an uncommitted editor draft so the user can correct it without retyping;
- mark the involved Stacks and source dimensions as activation errors;
- do not write a partial history or autosave state;
- display a message naming the repeated Stack states and causing dimension references.

Use a finite maximum-round safeguard in addition to repeated-state detection. Reaching the safeguard is an error, never successful completion.

### Driven-dimension availability

- A driven dimension from an effectively enabled source Stack is available after that source's accepted solve refreshes it.
- A driven dimension from a disabled or ancestor-disabled Stack is unavailable.
- Referencing a driven dimension owned by the target Stack itself creates an activation self-dependency and must be diagnosed.
- If an external source Stack is temporarily unavailable, the dependent Stack remains disabled with a structured blocked-dependency diagnostic and reevaluates automatically when the source becomes available.
- Values cached from the last time a Stack was enabled must not be used as if they were current driven measurements.

### Solve failure during activation

If newly enabling a subtree introduces an unsatisfied or invalid constraint system:

- roll geometry, effective activation, and the committed expression back to the last accepted state;
- retain the rejected expression as an uncommitted editor draft and attach a Stack activation error;
- identify the Stack, dimension/constraint, and expression that triggered activation;
- never leave only part of the subtree active.

When an already-saved drawing is loaded with an invalid activation expression and no prior accepted runtime state exists, retain the stored expression, fail the affected Stack closed, and surface the diagnostic. Import must not silently rewrite user-authored configuration logic.

## Subtree lifecycle rules

### Recursive deletion

Deleting Stack `P` operates on `subtreeStackIds(P)` in one atomic transaction.

- Delete all descendant Stack records.
- Delete every entity, dimension, dimension annotation, constraint, and extension-owned definition directly owned by any deleted Stack.
- Remove surviving cross-Stack constraints and dimensions that reference deleted records under the existing Stack deletion rules.
- Preserve surviving global Parameters but mark expressions referencing deleted dimensions as errors.
- Remove dormant templates whose required source identity no longer exists anywhere in the drawing.
- Choose a new active Stack from the nearest effectively enabled ancestor, then nearby enabled tree order, then any enabled top-level Stack.
- If no effectively enabled Stack remains, set the active Stack to `null` and disable drawing-creation tools.
- Undo restores the entire subtree, all records, relationships, expressions, prior active Stack, and prior activation state.

The confirmation UI must report descendant and owned-record counts before commit.

### Parent export

Native ParaMagic/JSON Stack export includes:

- the selected parent and every descendant Stack;
- parent links and sibling order within the exported subtree;
- enabled expressions and local visibility values;
- all directly owned records;
- all required global Parameter and Control dependencies under existing portable-package rules;
- active internal relationships;
- dormant intent for relationships crossing outside the subtree.

Geometric subtree exports include only effectively enabled records from the selected subtree and apply existing visibility/export rules after activation filtering.

### Subtree insertion

- Allocate a new globally unique opaque live Stack ID for every inserted Stack instance without consulting its name and without reusing an incoming ID.
- Remap every `parentStackId` through the Stack ID map.
- Preserve subtree shape and sibling order.
- Apply globally unique suffixes independently to every colliding Stack name.
- Rewrite all qualified dimension references through `NamingSystem.js`.
- Allocate inserted dimensions sequentially per destination Stack.
- Remap dimension, annotation, constraint, relationship, entity, and extension IDs.
- Insert the same package repeatedly as independent subtrees.
- Reconcile dormant external relationships after every insertion until all compatible relationships are active.

## Permanent Stack tree UI

### Layout

Replace the floating panel with a permanent docked sidebar below the application header.

```text
+---------------------- Application header -----------------------+
|                                                                  |
+---- Stacks sidebar ----+---------------- Canvas -----------------+
| +  ...                 |                                         |
| v Bodice               |                                         |
|   |- Front             |                                         |
|   `- Back              |                                         |
| > Sleeve               |                                         |
|   Markings             |                                         |
|                        |                                         |
+------------------------+-----------------------------------------+
```

- The sidebar is independently scrollable.
- Width is resizable and persisted as an application preference.
- It is not a floating overlay and has no close button.
- No Stack geometry thumbnail is generated or subscribed to.
- The canvas resizes rather than being covered.
- Narrow layouts retain a compact but visible tree; they do not restore the floating panel.

### Tree row

A compact row should expose state without becoming visually noisy.

```text
[disclosure] Stack Name [warning] [eye when enabled]  -> hover ->  [+] [A + pencil rename] [Enabled switch] [Expression when off] [Save As] [delete]
```

Required states:

- selected;
- active drawing target;
- locally expression-disabled;
- effectively disabled by an ancestor;
- hidden;
- expression blocked, invalid, cyclic, or oscillating;
- relationship/solve error count within the subtree.

The UI must visually distinguish local disablement from inherited ancestor disablement.

### Selection and activation

- Single click selects a row without changing the active drawing target.
- Double-click activates an effectively enabled Stack.
- Selecting a disabled Stack does not activate it.
- Inactive Stack rows do not reveal a toolbar on hover or focus. If the active Stack is switched off, its toolbar remains available only for the uninterrupted enable-expression edit that initiated the state change.
- The active Stack has a persistent marker distinct from ordinary selection.

### Enable expression editor

When the row's manual Enabled switch is off, that row's toolbar exposes:

```text
Expression    [ d1@Structure >= 1200 mm             ]
```

- Every Stack row owns a horizontal toolbar positioned immediately to the right of that row, but only the active Stack reveals it on hover or focus.
- The toolbar places Add Child and Rename first, followed by the track-and-thumb Enabled switch and its conditional expression editor, then Save As and Delete.
- The visibility eye remains in its original Stack-row position while the Stack is effectively enabled and is hidden while the Stack is effectively disabled.
- Switching Enabled off reveals the expression editor inside the same toolbar; switching it on hides the editor without erasing its expression.
- A blank expression displays `FALSE` as its hint and evaluates to `FALSE`; a nonblank expression can enable the Stack while the manual switch is off without adding an `fx` marker to the row.
- Expression autocomplete uses the existing expression symbol lookup and Stack-context rules.
- Errors appear next to the Stack row and expression box and name the causing Stack/dimension.
- A successful edit commits through one activation transaction and is undoable. A rejected edit remains an editor draft and does not enter drawing history or autosave.

### Expansion and keyboard access

Use semantic `role="tree"` and `role="treeitem"` behavior.

- Parent Stacks use a borderless 28 px square disclosure button with a 21 px chevron that points right when collapsed and down when expanded.
- `Up`/`Down`: previous/next visible tree row.
- `Left`: collapse an expanded Stack; otherwise select its parent.
- `Right`: expand a collapsed Stack; otherwise select its first child.
- `Enter`: activate an effectively enabled selected Stack.
- `Space`: toggle the selected Stack's manual Enabled switch.
- `F2`: replace the selected row's name label with its inline Name textbox and select the text.
- `Delete`: open subtree deletion confirmation; never delete immediately.
- Expansion changes UI state only and does not create drawing history.

### Reorder and reparent

Pointer dragging must expose three unambiguous drop targets:

- before a row;
- inside a row as its last child;
- after a row.

Requirements:

- show a line for before/after and an inset highlight for inside;
- auto-expand a collapsed potential parent after a hover delay;
- preserve the entire moved subtree;
- reject self/descendant drops before mutation;
- perform one history transaction;
- use pointer dragging for hierarchy movement;
- do not solve merely because hierarchy changed.

### Row hover toolbar

Required actions:

- Add Child Stack;
- Rename;
- Enabled switch and conditional expression editor;
- Save Stack As;
- Delete Stack.

The toolbar is horizontal, belongs to its Stack row, appears on hover or keyboard focus only while that Stack is active, and is anchored immediately outside the row's right edge so it does not cover the Stack item or adjacent rows. A toolbar that initiated disabling stays open only for that uninterrupted enable-expression edit. A 700 ms exit grace period lets the pointer cross the gap between the row and its toolbar without dismissing it. The visibility eye remains on the row only while the Stack is effectively enabled.
Rename replaces the Stack name label in that same row with an inline textbox; no detached inspector textbox is used. Toolbar buttons use the shared icon language and center icons in enlarged hit targets.

User-visible labels call these objects Stacks. `subtree` remains an internal term for the recursive closure of a Stack and its descendants.

## History and transaction behavior

Drawing-history commits:

- add Stack;
- rename Stack;
- reorder or reparent Stack;
- edit enable expression;
- change manual enablement;
- change local visibility;
- move geometry to another Stack;
- insert/duplicate subtree;
- delete subtree.

Non-history UI state:

- selected tree row;
- expanded/collapsed rows;
- sidebar scroll position;
- sidebar width;
- reveal-active navigation.

Activation driven by a parameter or geometry edit belongs to the initiating edit's transaction. It must not create a second independent history entry.

## Migration and compatibility

### Version-2 Stack migration

For every existing drawing:

- replace every legacy or name-derived live Stack ID with a newly generated opaque Stack ID;
- atomically remap `activeStackId`, `parentStackId`, direct record owners, `participantStackIds`, relationships, dormant templates, and every other Stack-ID reference through the migration ID map;
- preserve lineage in `sourceStackId` where required for portable relationship reactivation, but never use it as live identity;
- preserve each Stack name, visibility, and array order;
- set `parentStackId: null`;
- convert flat array order to top-level `order`;
- set `enabled: true` and `enabledExpression: ""`;
- preserve the existing active Stack when it remains effectively enabled;
- keep every existing record's direct Stack ownership;
- run existing dimension/constraint/relationship migration before the solver loads;
- produce version-4 output idempotently.

The live solver and Stack tree must accept only the canonical version-4 model. Legacy conversion remains at the drawing-load boundary.

### Saved drawings and autosave

- Native saves retain disabled Stacks and their data.
- Autosave captures only accepted stable activation/solve states.
- A failed or oscillating activation transaction must not overwrite the last accepted autosave checkpoint with partial geometry.
- Thumbnails and recent-file previews omit effectively disabled geometry but retain the drawing data in the file.

## Delivery phases and checklist

### Phase 0 — Contract fixtures and baseline

- [ ] Check in this plan and link it from the module index or solver documentation where appropriate.
- [ ] Add a canonical nested-Stack fixture with parent-owned and child-owned geometry.
- [ ] Add a structural support-rail fixture controlled by a driven dimension threshold.
- [ ] Add cross-Stack constraint, Linked Copy, and Swell relationships across sibling and parent/child Stacks.
- [ ] Add static activation-cycle and runtime oscillation fixtures.
- [ ] Capture current flat Stack save/insert/delete behavior before replacement.
- [ ] Add performance measurements for Stack panel rendering, Stack solve-group construction, and disable/enable transitions.

Exit criteria:

- Every agreed behavior has a named fixture and expected result before production mutation begins.
- The support-rail fixture demonstrates both enabling above the threshold and disabling below it.

### Phase 1 — Canonical Stack tree core

- [ ] Bump Stack architecture and extension versions to 3.
- [ ] Add `parentStackId`, sibling `order`, and `enabledExpression` normalization.
- [ ] Build hierarchy indexes and pure ancestor/descendant/subtree helpers.
- [ ] Reject cycles, missing parents, duplicate IDs, and invalid active Stack references.
- [ ] Implement child/sibling creation, reorder, and reparent root APIs.
- [ ] Implement selected-versus-active Stack state.
- [x] Implement nullable activation without automatic fallback when a Stack becomes unavailable.
- [ ] Migrate flat drawings idempotently.
- [ ] Add core tests for deep trees, wide trees, ordering, reparenting, and invalid moves.

Exit criteria:

- Tree normalization is deterministic and idempotent.
- Reorder/reparent changes hierarchy only.
- No hierarchy operation changes Stack IDs or record ownership.

### Phase 2 — Subtree lifecycle and portability

- [ ] Implement one canonical subtree closure API.
- [ ] Route deletion, native export, geometric export, duplication, and insertion through that closure.
- [ ] Implement recursive deletion with cross-reference pruning and global expression errors.
- [ ] Implement atomic subtree undo/redo.
- [ ] Export parent/descendant hierarchy and internal relationships.
- [ ] Preserve partial external relationships as dormant portable intent.
- [ ] Insert with complete ID remapping, name suffixing, parent remapping, and expression rewriting.
- [ ] Verify Stack IDs are produced only by the canonical ID factory and contain no Stack-name material.
- [ ] Repeat-insert a subtree as independent instances.
- [ ] Update clipboard tests so ordinary geometry copying does not pull in ancestors.

Exit criteria:

- Delete parent, undo, and redo preserve exact subtree state.
- Native save/open preserves hierarchy, expressions, live IDs, and relationships; export/insert preserves content while assigning new live Stack IDs.
- Inserting the same subtree twice creates independent live Stack and record IDs.

### Phase 3 — Stack activation expression graph

- [ ] Add `StackActivationSystem.js`.
- [ ] Compile enable expressions through the existing expression engine.
- [ ] Add stable symbol-ID and reverse-dependent indexes.
- [ ] Support global Parameters, Controls, document variables, driving dimensions, and driven dimensions.
- [ ] Add distinct unavailable-disabled-Stack errors.
- [ ] Calculate local and ancestor-derived effective enablement.
- [ ] Add static activation-cycle diagnostics.
- [ ] Keep disabled Stack names and dimension identities reserved.
- [ ] Rewrite enable expressions on every supported rename.
- [ ] Add tests for dirty-only reevaluation and mixed-unit Boolean expressions.

Exit criteria:

- Updating one source value reevaluates only dependent Stack expressions.
- The same expression resolves identically in the parameter editor and Stack enable editor.
- Static cycles identify every participating Stack and dimension.

### Phase 4 — Incremental solver stabilization

- [ ] Filter Stack participation and constraint graphs by effective enablement.
- [ ] Delta-remove newly disabled subtree variables, dimensions, and constraints.
- [ ] Delta-add newly enabled subtree solver state.
- [ ] Suppress and reactivate runtime cross-Stack relationships without mutating serialized intent.
- [ ] Return changed driven-dimension IDs from Stack solves.
- [ ] Implement the transactional solve/evaluate/activate stabilization loop.
- [ ] Detect repeated activation-state signatures and maximum-round exhaustion.
- [ ] Roll back geometry and effective activation atomically on solve failure or oscillation.
- [ ] Propagate structured errors to Parameters and Stack UI.
- [ ] Add worker protocol messages and parity tests for activation changes.

Exit criteria:

- The support rail enters and leaves the drawing as its source driven length crosses the threshold.
- Unrelated Stacks are never solved during that transition.
- Cyclic or oscillating activation never hangs and never partially commits.

### Phase 5 — Presentation and export filtering

- [ ] Exclude effectively disabled records from SVG DOM creation and record interaction.
- [ ] Exclude them from selection, snapping, helpers, bounds, Zoom All, closed regions, and derived presentation systems.
- [ ] Preserve hidden-versus-disabled semantics.
- [ ] Exclude effectively disabled records from DXF, SVG, PNG, print, and thumbnails.
- [ ] Retain disabled data in native save, autosave, and native Stack packages.
- [ ] Add effective-enabled filters to extension-owned derived geometry.
- [ ] Verify enabling restores presentation from authoritative records without recreating identities.

Exit criteria:

- Disabled geometry has no rendered or interactive residue.
- Re-enabling restores the same IDs and accepted solved geometry.
- Native save retains data that geometric exports omit.

### Phase 6 — Permanent Stack tree sidebar

- [ ] Create `StackTreePanel.js`.
- [ ] Replace floating panel markup, dragging, close behavior, cards, and thumbnails.
- [ ] Add docked resizable layout below the header.
- [ ] Render keyed tree rows with semantic accessibility roles.
- [ ] Add active, selected, hidden, local-disabled, inherited-disabled, formula, and error states.
- [ ] Add expansion, keyboard navigation, and independent scrolling.
- [ ] Add before/inside/after drag targets and cycle prevention.
- [ ] Add child creation and per-row hover-toolbar actions.
- [ ] Add per-row toolbar enable-expression editor and autocomplete.
- [ ] Add recursive deletion confirmation counts.
- [ ] Remove thumbnail object/presentation subscriptions.
- [ ] Repurpose or remove the toolbar Stacks toggle.
- [ ] Verify all canvas coordinate transforms after sidebar resize.

Exit criteria:

- Every tree operation is usable by pointer and keyboard.
- The sidebar never overlays the canvas and cannot be accidentally closed.
- Object edits do not rerender geometry thumbnails or the complete Stack tree.

### Phase 7 — End-to-end, performance, and migration gates

- [ ] Run the complete automated test suite and classify unrelated baseline failures.
- [ ] Run production build validation.
- [ ] Open a real legacy flat drawing through the visible Open workflow and verify migrated top-level rows.
- [ ] Save, close, reopen, and verify hierarchy, order, expressions, disabled state, and nullable activation.
- [ ] Exercise the support-rail driven-dimension fixture in the rendered app in both threshold directions.
- [ ] Verify parent disable/re-enable with independently disabled children.
- [ ] Verify recursive delete plus undo/redo in the rendered app.
- [ ] Export and reinsert a parent subtree twice in the rendered app.
- [ ] Verify internal and external dormant relationships after separate insertion.
- [ ] Verify cycle, missing-source, solve-failure, and oscillation messages name the exact Stack and dimension.
- [ ] Benchmark large enabled and mostly-disabled drawings.
- [ ] Verify no regression in table keyboard behavior, Parameters editing, clipboard, Controls, Linked Copy, Swell, or ordinary drawing tools.

Exit criteria:

- Every acceptance scenario below is demonstrated end-to-end in the rendered application.
- Disabled-subtree solve cost is absent from active solve diagnostics.
- No partial state is persisted after failure.

## User-visible acceptance scenarios

Completion cannot be claimed until all scenarios are tested through the rendered application.

1. Create a parent, add children, add a grandchild, save, reopen, and preserve exact hierarchy and sibling order.
2. Drag a subtree before, inside, and after other Stacks; reject a drop onto its own descendant.
3. Draw geometry directly in a parent and a child; verify direct ownership remains unchanged after reparenting.
4. Rename a Stack and verify every qualified expression, including enable expressions, updates exactly once.
5. Delete a parent and verify all children and owned records disappear; undo restores all identities and relationships.
6. Export a parent and insert it into another drawing; verify the full subtree, internal relationships, sequential dimensions, and rewritten names.
7. Insert the same subtree twice and verify independent IDs with standard name suffixes.
8. Switch a child off with a blank expression; verify it disappears from canvas, solver, snapping, bounds, and DXF/SVG/PNG while remaining in native save.
9. Disable a parent and verify every descendant becomes effectively disabled while child expressions remain unchanged.
10. Re-enable the parent and verify children return according to their own expressions.
11. Drive a Support Rail Stack with `d1@Structure >= threshold`; verify the source driven dimension enables and disables it after solves in both directions.
12. Verify only source, newly activated, and explicitly connected Stack groups solve during the support-rail transition.
13. Disable the driven-dimension source Stack and verify the dependent Stack reports an unavailable-source diagnostic.
14. Create a static activation cycle and verify the message names both Stacks and dimensions.
15. Exercise an oscillating activation fixture and verify rollback to the last stable drawing with no hang or partial history.
16. Verify a cross-Stack constraint, Linked Copy relationship, and Swell relationship suppress when one participant is disabled and reactivate when enabled.
17. Verify enabled global expressions referencing a disabled dimension report the disabled Stack rather than an unknown symbol.
18. Activate, select, and manage a disabled Stack without enabling it or adding it to the solve/render set.
19. Double-click the active Stack to leave no Stack active and verify drawing-creation tools become unavailable; double-click a disabled Stack and verify it becomes active without becoming enabled.
20. Navigate, expand, activate, rename, reorder, and initiate delete entirely by keyboard.
21. Resize the sidebar and verify pointer coordinates, snapping, overlays, Zoom All, and exports remain correct.
22. Open an unmodified version-2 drawing and verify every existing Stack appears as an enabled top-level tree row with unchanged IDs and records.

## Performance acceptance criteria

- Removing the current thumbnail panel eliminates Stack-thumbnail generation and object-change thumbnail subscriptions.
- Tree expansion, selection, and reorder do not schedule geometry solves.
- Tree row updates are keyed to changed Stack IDs; object geometry changes do not rebuild the tree.
- Enable-expression evaluation is proportional to dirty reverse dependents, not total Stack count.
- Parent effective-state propagation is proportional to the affected subtree.
- Disabled Stacks contribute zero active variables and residual blocks to solver diagnostics.
- A driven-dimension activation transition solves only the source group, newly activated group, and explicit relationship closure.
- Repeated activation converges to a stable state without unbounded rounds.
- A tree containing hundreds of rows remains keyboard- and pointer-responsive; add windowed row rendering only if measured DOM cost requires it.
- Main-thread sidebar updates should fit within one animation-frame budget for ordinary single-subtree operations.

## Risks and required safeguards

| Risk | Safeguard |
| --- | --- |
| Parent/child containment accidentally recreates global solving | Never add hierarchy edges to `StackSolveSystem`; use only explicit participant/dependency edges. |
| A driven value is stale while its source Stack is disabled | Mark it unavailable; never activate from a cached driven measurement. |
| Activation alternates forever | Repeated-state detection, static dependency checks, and a finite round limit. |
| Reparenting corrupts expressions | Keep names and IDs stable; hierarchy paths never appear in expression syntax. |
| Disabling deletes relationships | Runtime suppression must not mutate persistent records or dormant templates. |
| Recursive delete leaves references | Use one canonical subtree closure and one atomic cross-reference cleanup transaction. |
| Insert duplicates IDs or names | Remap every stable ID and apply centralized global Stack-name suffixing. |
| Sidebar resize offsets canvas input | Recompute transforms from actual canvas bounds and cover pointer workflows end-to-end. |
| Manual toggling destroys a conditional expression | Store `enabled` and `enabledExpression` independently; hide but preserve the expression while manual enablement is on. |
| Failed stabilization leaks partial state into history/autosave | Restore last accepted geometry and activation state before history or autosave commits. |
| UI logic grows `infiniteCanvas.js` | Keep tree behavior in `StackTreePanel.js` and activation behavior in `StackActivationSystem.js`. |

## Definition of done

The upgrade is done only when:

- version-4 Stack tree state is the sole live core representation;
- legacy flat drawings migrate only at the import boundary;
- subtree delete/export/insert share one canonical closure implementation;
- expression-driven enablement supports driven dimensions and stabilizes with incremental Stack solves;
- cycles, unavailable sources, solve failures, and oscillation produce precise Stack/dimension diagnostics;
- disabled subtrees are absent from active solving and geometric presentation without losing persistent data;
- the docked accessible tree fully replaces the thumbnail floating panel;
- the complete automated suite, production build, performance gates, and every rendered acceptance scenario pass;
- `infiniteCanvas.js` contains orchestration wiring only;
- `docs/MODULE_INDEX_MAP.md` and `docs/SOLVER.md` describe the final shipped ownership and stabilization contract.
