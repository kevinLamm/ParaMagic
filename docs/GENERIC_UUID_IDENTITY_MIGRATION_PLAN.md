# ParaMagic Generic UUID Identity Migration Plan

## Objective

Replace ParaMagic's mixed identity schemes with one canonical, drawing-wide UUID system.

After this upgrade:

- every persistent ParaMagic record identity is a raw UUID;
- every internal reference to a persistent record contains that UUID;
- UUIDs never encode record type, name, hierarchy, position, or feature role;
- every new independent record is allocated through one core identity authority;
- save/open preserves live UUIDs;
- duplicate, paste, Insert, and independent Save As operations allocate new live UUIDs and remap the complete reference graph;
- user-visible handles such as `d1`, Stack names, Parameter names, and Control names remain names rather than identities;
- structural locators, external identifiers, enum values, DOM identifiers, and protocol tokens are explicitly named as keys, handles, codes, or locators instead of being passed off as ParaMagic IDs;
- the live application, solver, history, clipboard, and tool modules operate only on the canonical identity model.

This is a root-level architecture replacement. It must not be implemented as a compatibility patch or as a collection of unrelated tool-local ID generators.

## Relationship to the Stack tree upgrade

This plan is a prerequisite for the persistent-schema, insertion, clipboard, relationship, and history phases of `STACK_TREE_ACTIVATION_PLAN.md`.

The Stack tree must be built on generic UUID identity from its first live version. In particular:

- Stack `id`, `parentStackId`, `activeStackId`, `ownerStackId`, and `participantStackIds` use raw UUIDs;
- a Stack ID has no relationship to its name;
- inserting the same Stack subtree repeatedly produces independent UUID graphs;
- `sourceStackId` is UUID lineage metadata and never a live-ID reuse instruction;
- the old same-ID/`mergeTarget` Stack insertion behavior is removed before tree insertion is implemented.

## Meaning of “generic UUID”

The canonical ParaMagic ID representation is a lowercase RFC 9562 UUID string in the ordinary 36-character form:

```text
9f706d74-061b-4d88-a398-8b24167f9e02
```

It is not:

```text
stack-9f706d74-061b-4d88-a398-8b24167f9e02
constraint-9f706d74-061b-4d88-a398-8b24167f9e02
stack-default
line-17
shape-1700000000-4
array-derived:<array>:2:<source>
```

Rules:

1. New independent identities use UUID version 4.
2. The generator accepts no record-type or name prefix.
3. UUID type is determined by the owning record/collection, never parsed from the UUID.
4. Newly generated UUIDs are lowercase and canonical.
5. Imported uppercase UUIDs may be normalized to lowercase at the file boundary.
6. A generator may retry if a UUID is already reserved in the target transaction or drawing.
7. Counter, timestamp, `Math.random()`, record-name, and content-derived fallbacks are prohibited.
8. If secure browser randomness is unavailable, identity creation fails explicitly. It must not silently weaken uniqueness.
9. UUIDs are opaque. Production code must not split them, append to them, extract type information from them, or use their lexical ordering as creation order.
10. Human-readable diagnostics show the record type and name separately, with an optional shortened UUID for debugging.

## Identity versus reference

“Every ID is unique” means every independently declared identity receives a UUID that is not reused by another independent declaration.

The same UUID will correctly appear in multiple references to that identity. For example, an entity's UUID may appear in a constraint feature reference, a dimension anchor, an Array source list, and selection state. Those are not duplicate identities; they are references to one identity.

Lineage UUIDs may also repeat deliberately. Two inserted copies can both record the same source UUID while having different live UUIDs.

## Identity taxonomy

Every field currently named `id`, ending in `Id`, or ending in `Ids` must be classified. No ambiguous category is allowed after migration.

### 1. Persistent domain identity

A serialized record or independently addressable drawing object.

Requirements:

- raw UUID declaration;
- drawing-wide uniqueness;
- immutable for the life of that record;
- included in the identity schema registry;
- preserved by save/open and history;
- remapped when an independent copy is created.

Examples include Stacks, Classes, entities, Parameters, dimensions, constraints, annotations, Array definitions, Linked Copy definitions, Swell relationships, and panel Controls.

### 2. Persistent domain reference

A field that points to a persistent domain identity.

Requirements:

- raw UUID value, or an array/set of raw UUID values;
- schema-declared target kind or allowed target kinds;
- remapped through the same transaction map as its declaration;
- validated for dangling or forbidden cross-drawing references.

Examples include `stackId`, `classId`, `parentStackId`, `participantStackIds`, `recordId`, `dimensionId`, `parameterId`, `sourceIds`, and `copyId`.

### 3. Portable lineage reference

A UUID identifying the source identity from which a live record was inserted or copied. Its target need not be present in the active drawing.

Requirements:

- raw UUID;
- optional on original records;
- never entered into the live declaration index;
- never used to bypass fresh-ID allocation;
- never treated as proof that two live records should merge;
- used only by explicitly owned portable relationship workflows.

Examples include `sourceStackId`, `sourceRecordId`, `sourceDimensionId`, `sourceDefinitionId`, and `sourceRelationshipId`.

### 4. Runtime identity

An actual independently addressable runtime object, such as a solver variable, that is held in an ID-indexed collection.

Requirements:

- use a raw UUID if it remains an actual `id`/`*Id`;
- never serialize unless promoted to persistent identity;
- allocate once for the object's runtime lifetime, not on every solve or render;
- retain semantic role in separate fields such as `ownerId` and `parameterKey`.

### 5. Structural locator or deterministic key

A value describing a location, role, array placement, topology cycle, generated visual, or feature path. It is not an independent identity.

Requirements:

- must be called `key`, `locator`, `path`, `role`, `index`, or another accurate name;
- must not be stored in an `id`, `*Id`, or `*Ids` field;
- must not share maps with UUID identities;
- if it becomes independently referenceable, promote it to a stored UUID-backed record or store a structured locator containing UUID references.

Examples include Array placement locators, boundary-cycle membership, seam-line presentation keys, fillet topology roles, and subtract-result presentation keys.

### 6. External or platform identifier

An identifier owned by a browser API, file format, remote asset store, DOM, SVG, or protocol.

Requirements:

- retain the external format required by that system;
- use an explicit name such as `pickerKey`, `formatKey`, `dxfHandle`, `assetReference`, `pointerToken`, `domId`, or `requestToken`;
- never enter ParaMagic's drawing identity registry;
- never be remapped by drawing copy/Insert logic.

## Current mixed schemes to remove

The migration must remove these current patterns from domain identity:

- `createStableId(prefix)` in `solver/SolverModel.js`;
- local `newId(prefix)` in `DrawingIO.js`;
- local UUID/counter generators in `DrawingTools.js`, `TextTools.js`, `TableTools.js`, `ImageSystem.js`, `FilletSystem.js`, and other tools;
- typed UUID wrappers such as `stack-<uuid>`, `dimension-<uuid>`, `linked-copy-<uuid>`, and `swell-constraint-<uuid>`;
- semantic sentinels such as `stack-default`, `class-x`, and `__paramagic_canvas_origin__`;
- counter and timestamp fallbacks;
- composite child IDs created by appending `-segment-<index>`;
- solver variable IDs created by appending `:<parameter-name>` to an entity ID;
- topology/solver IDs such as `component:<variable>`, `intrinsic:<entity>`, and `cycle:<members>`;
- Array and Linked Copy derived IDs that encode multiple IDs and an index into one string;
- presentation IDs such as `seam-line-v2:<region>:<index>` and `subtract-result:<owner>`;
- virtual document-variable records identified as `document:<name>`;
- blind recursive replacement of any string that happens to equal an ID.

## Canonical core ownership

### New `IdentitySystem.js`

This module is the only production UUID authority.

It owns generic identity primitives only:

```js
createUuid()
isUuid(value)
normalizeUuid(value)
assertUuid(value, context)
createUuidAllocator(reservedUuids)
```

Contract:

- `createUuid()` returns a raw lowercase UUID v4;
- it uses `crypto.randomUUID()` when available;
- a secure `crypto.getRandomValues()` UUID-v4 implementation may be used as the supported fallback;
- it never receives a prefix or record type;
- it never reads a record name;
- it never uses a module-local serial;
- allocation against a drawing or transaction checks the reserved UUID set and retries on collision;
- validation is performed at creation/load/commit boundaries rather than repeatedly inside hot solver loops.

### New `DrawingIdentitySystem.js`

This module owns the complete ParaMagic drawing identity graph.

Suggested APIs:

```js
registerIdentitySchema(extensionKey, descriptor)
createDrawingIdentityIndex(drawing)
validateDrawingIdentityGraph(drawing, options)
migrateDrawingIdentities(input, options)
remapDrawingIdentityGraph(input, options)
cloneDrawingIdentityGraph(input, options)
identityAudit(drawing)
```

Responsibilities:

- enumerate every persistent identity declaration;
- enumerate every persistent live reference;
- enumerate portable lineage references separately;
- enforce drawing-wide UUID uniqueness;
- produce schema-path diagnostics;
- allocate complete transaction remap tables before rewriting any record;
- remap only declared reference fields;
- preserve explicitly external references when allowed;
- reject ambiguous or dangling canonical references;
- support complete drawing clone, subtree Insert, and clipboard subset operations;
- expose an immutable identity index for Stack, solver, selection, history, and IO consumers.

### Extension-owned identity descriptors

Tool serialization and migration remain owned by each tool module under `CODEXRULES.md`.

Every module that serializes extension records must export or register an identity descriptor defining:

- declarations it owns;
- live references it owns;
- optional lineage references it owns;
- allowed missing/dormant references;
- structural locators that are not identities;
- copy/Insert inclusion policy.

The central drawing identity system coordinates descriptors. It must not guess extension structure by recursively replacing arbitrary strings.

Required descriptors include at least:

- Array Tools;
- Linked Copy/Symmetric;
- Swell;
- Seam Lines;
- Stack relationships/dormant templates;
- Controls/panel controls;
- any image, trace, notch, fillet, or subtract data that declares or references an independent record.

## Canonical drawing identity contract

The upgraded native drawing adds an explicit identity schema version and a drawing UUID.

Illustrative shape:

```js
{
  format: "ParaMagic Drawing",
  version: 4,
  identityArchitectureVersion: 1,
  drawingId: "771e5576-81c8-4df3-8081-645c21e03ea6",
  entities: [
    {
      id: "5fc2ce38-f9d4-4a52-9379-b37cd73df721",
      type: "line",
      stackId: "378387e8-e28a-446d-84c1-410863be36d7",
      classId: "4db09bd2-a6f6-4ed7-b6d7-0369a092f683"
    }
  ],
  constraints: [
    {
      id: "ca8d6596-0c66-4c78-b468-0941706c06e1",
      type: "Horizontal",
      stackId: "378387e8-e28a-446d-84c1-410863be36d7",
      featureRefs: [
        {
          kind: "segment",
          recordId: "5fc2ce38-f9d4-4a52-9379-b37cd73df721",
          index: 0
        }
      ]
    }
  ]
}
```

No type can be inferred from these UUID values. The surrounding schema supplies the meaning.

## Persistent identity inventory

The implementation inventory must be completed and checked into tests before conversion begins. At minimum it includes the following.

### Drawing and system records

- drawing root: `drawingId`;
- Stack records and Stack tree references;
- Class records and active/default Class references;
- persistent panel Control items;
- any persisted application-owned resource embedded in a drawing.

The Default Stack and Default Class become ordinary UUID-backed records with explicit roles:

```js
{
  id: "<uuid>",
  systemRole: "default-stack",
  removable: false
}
```

```js
{
  id: "<uuid>",
  systemRole: "default-class",
  removable: false
}
```

There is no global `DEFAULT_STACK_ID` or `DEFAULT_CLASS_ID` value after migration. Code resolves the default record by role from the current drawing state.

### Geometry and grouped geometry

- every entity `id`;
- geometry references in feature descriptors and anchors;
- composite/group UUIDs;
- `compositeId`, source-record references, and segment membership;
- fillet, notch, text, table, and image entity identities;
- paint-order record references;
- subtract parent/cutter references;
- closed-boundary and topology references that persist.

Repeated composite membership must be represented as references to one composite UUID. A segment's position remains a separate numeric index and is never appended to the UUID.

### Parameters, Controls, dimensions, and constraints

- user Parameter IDs;
- Control Parameter IDs;
- dimension Parameter IDs;
- panel Control item IDs;
- constraint IDs;
- dimension annotation IDs;
- dimension/constraint cross-references;
- `parameterId`, `dimensionId`, `annotationId`, `recordId`, and related arrays;
- external-driving targets owned by extension constraints.

`d1`, user Parameter names, and Control names remain expression symbols. They are not UUIDs and are never remapped by the identity system.

### Stack ownership and relationships

- Stack `id`;
- `activeStackId`;
- future `parentStackId`;
- direct `stackId`/`ownerStackId` on every owned record;
- `participantStackIds`;
- active relationship IDs;
- dormant relationship-template IDs where the template is independently stored;
- source-lineage UUIDs.

### Extension-owned declarations and references

- Array definition IDs, source references, center references, and owned controls;
- Linked Copy definition IDs, source references, external driving targets, and position-constraint IDs;
- Swell definition/piece/relationship identities where independently persisted;
- Seam Line definition identity and its boundary/source references;
- image entities and drawing-owned image asset identities;
- any future extension record registered through the extension provider.

An extension that serializes an `id` or `*Id` field without an identity descriptor must fail the identity audit and build gate.

### Portable lineage

These fields become optional UUID references and retain no name/type prefix:

- `sourceStackId`;
- `sourceRecordId`;
- `sourceDimensionId`;
- `sourceDefinitionId`;
- `sourceRelationshipId`.

Original records may use `null` rather than redundantly copying their own live UUID into a source field.

## Pseudo-identities and derived identifiers

### Canvas origin

`__paramagic_canvas_origin__` is a singleton role, not a drawing-record identity.

Replace pseudo-record references with a discriminated reference that has no `recordId`:

```js
{ kind: "canvas-origin", pointRole: "origin" }
```

Constraint and dimension resolvers dispatch on `kind`. No fake UUID is required.

### Document variables

`document:<name>` values are expression-symbol definitions, not persistent record identities.

Replace their `id` field with a semantic `symbolKey` or use the existing name as the symbol key. If a document variable later becomes a persistent independently addressable record, it must then receive a UUID.

### Boundary cycles and subtract targets

Replace encoded strings such as `cycle:<id>|<id>` with structured data:

```js
{
  kind: "boundary-cycle",
  memberRecordIds: ["<uuid>", "<uuid>"]
}
```

The member UUIDs are remapped normally. The cycle itself is a structural locator unless it is promoted to a persistent record.

### Arrays and Linked Copy derived geometry

Encoded derived IDs must be replaced by one of two explicit models:

1. A derived visual that cannot be referenced persistently uses a `derivedKey`/structured locator and never appears in a `recordId` field.
2. A derived object that can be constrained, dimensioned, selected across reload, or otherwise referenced persistently receives a stored UUID identity owned by its Array/Linked Copy definition.

Placement index, source UUID, copy UUID, and feature role remain separate fields. They are never concatenated into an ID.

### Seam Lines, fillet topology, and subtraction presentation

Values such as `seam-line-v2:<region>:<index>`, `<fillet>:tangent-first`, and `subtract-result:<owner>` are computed presentation or solver keys.

- Rename them to `presentationKey`, `topologyKey`, or `runtimeConstraintKey` when they remain runtime-only.
- Do not serialize them as domain identities.
- If user-created dimensions or constraints can target them persistently, promote the target to a UUID-backed stored declaration or store a structured locator containing UUID references.

### Solver variables and components

Solver variables are runtime objects held in ID-indexed graphs. Their actual `id` values become raw UUIDs allocated once when a binding creates the variable.

The coordinate role currently encoded in values such as `<entity-id>:start.x` moves to explicit fields:

```js
{
  id: "<uuid>",
  ownerId: "<entity-uuid>",
  parameterKey: "start.x"
}
```

Solver components are transient graph groupings. Their stable membership signature is a `componentKey`, not a domain ID. If a component object retains an `id` field, it must be a UUID with a separate membership key.

Intrinsic solver equations and generated topology equations use runtime keys for diagnostics. They must not impersonate persistent constraint IDs.

### UI, browser, worker, and export identifiers

The following are not drawing UUIDs:

- DOM/SVG `id` attributes and ARIA link targets;
- pointer identifiers supplied by the browser;
- file-picker keys required by browser APIs;
- save-format keys such as `json`, `dxf`, `svg`, and `png`;
- IndexedDB store keys such as the active autosave slot;
- worker request sequence tokens;
- DXF handles and external image catalog references.

Rename internal fields so their category is explicit. For example:

- `format.id` becomes `format.key`;
- `pickerId` becomes `pickerKey` where allowed by the wrapper;
- worker `requestId` becomes `requestToken`;
- image manifest `id: reference` becomes `assetReference`;
- the autosave slot uses `slotKey` rather than pretending to be a drawing ID.

These values are excluded from drawing UUID validation and remapping.

## Creation contract

Every owning module receives a UUID or an allocator callback; it does not create its own ID format.

Required rules:

- a record factory allocates a UUID only when creating a genuinely new record;
- normalization never changes a valid canonical UUID;
- normalization does not silently invent a new UUID for a malformed canonical record;
- mutation transactions reserve all new UUIDs before commit;
- batched geometry creation allocates one UUID per entity and one per independent composite/group identity;
- generated constraints that persist receive their UUIDs at creation and preserve them thereafter;
- redo restores the UUIDs captured by the original command rather than creating new ones;
- rollback discards uncommitted UUIDs without reusing them deliberately;
- diagnostic or display code never changes identity.

## Save, open, Save As, and autosave

### Ordinary save/open

- preserve `drawingId` and every live record UUID exactly;
- validate the canonical graph before serialization and after parsing;
- write only the canonical identity architecture;
- never regenerate valid UUIDs during normalization.

### Autosave/recovery

- store the drawing's actual `drawingId` inside the payload;
- keep the IndexedDB active slot as a storage `slotKey`, not a drawing identity;
- recovery preserves the saved UUID graph;
- stale autosave comparison uses document metadata and revision state, not UUID lexical order.

### Independent Save As / Save Copy

When the command creates an independent drawing rather than another path to the same open document:

- allocate a new `drawingId`;
- clone and remap every live record identity as one atomic graph operation;
- preserve lineage UUIDs separately;
- rewrite all internal references;
- retain user-facing names and expressions under their normal naming rules.

An ordinary filesystem-level byte-for-byte copy cannot be detected by the application. If such copies are later inserted together, Insert still remaps every live declaration and prevents collision.

## Clipboard, duplicate, and Insert contract

### Duplicate within a drawing

- allocate a new UUID for every new declaration;
- map all internal references to the duplicates;
- preserve references to explicitly shared records only when the operation's ownership rules require sharing;
- never construct a child ID from the source ID.

### Geometry clipboard paste

- allocate new entity, dimension, annotation, constraint, composite, and included extension UUIDs;
- retain the destination Stack UUID when pasting into an existing Stack;
- apply Stack-local dimension naming rules independently of identity remapping;
- leave source-only external UUIDs as portable lineage/dormant references where supported;
- use a single remap table for the complete paste transaction.

### Drawing/Stack Insert

- allocate a new live UUID for every inserted declaration, including Stacks, even when the incoming UUID does not collide;
- remap all internal live references through the insertion map;
- preserve incoming UUIDs only as optional source-lineage UUIDs;
- insert the same package repeatedly as independent UUID graphs;
- remove same-ID implicit merging;
- permit intentional global Parameter, Control, or Class reuse only through explicit semantic merge rules, mapping the incoming UUID to the selected destination UUID.

Names and UUIDs are remapped by separate systems. `NamingSystem.js` owns names and expressions; `DrawingIdentitySystem.js` owns UUID declarations and references.

## Schema-aware remapping

The current recursive “replace any matching string” approach must be removed.

The replacement API must know whether a field is:

- an identity declaration;
- a live reference;
- a lineage reference;
- an optional dormant external reference;
- a user expression or ordinary text;
- an external key;
- a structural locator.

This prevents accidental rewrites of:

- text objects containing UUID-looking text;
- expressions or file paths;
- image URLs and content hashes;
- external catalog references;
- names that happen to equal an old ID;
- unrelated extension strings.

All declarations are allocated first. References are rewritten only after the complete transaction map exists.

## Legacy conversion boundary

Legacy compatibility exists only at the file/package loading boundary. There is no legacy-ID mode in live modules or the solver.

Proposed pipeline:

```text
parse raw file/package
  -> minimal legacy shape adapter
  -> discover identity declarations through registered schemas
  -> allocate complete UUID declaration map
  -> rewrite schema-declared references
  -> migrate Stack/Class/default roles and structural locators
  -> run naming/expression migration
  -> validate canonical identity graph
  -> hand canonical data to the live application
```

Migration requirements:

- convert prefixed UUIDs, counters, timestamps, sentinels, and arbitrary legacy strings;
- convert the Default Stack and Default Class to UUID-backed records with explicit roles;
- convert all references atomically;
- preserve portable lineage as UUID lineage;
- be idempotent once `identityArchitectureVersion: 1` is present;
- never emit mixed canonical/legacy state;
- report the record type, old value, and schema path for an unresolvable reference;
- fail closed on ambiguous duplicate legacy declarations rather than guessing;
- never pass malformed canonical UUID data to the solver.

### Duplicate legacy values

Legacy data may contain the same string in different declaration locations.

The migrator indexes declarations by schema path and declared kind before allocating UUIDs. A reference is resolved through its schema-declared target kinds. If more than one legacy declaration remains a valid target, migration stops with a diagnostic instead of assigning an arbitrary record.

### Portable legacy lineage

When legacy source values are not UUIDs, the migration produces UUID lineage values alongside the new live graph. Related records converted in one file/package transaction share the same lineage mapping.

The canonical serializer never writes the old lineage string back out. If an independently stored legacy package lacks enough origin information to reconnect safely to another independently migrated package, the loader reports that limitation and keeps the relationship dormant rather than manufacturing a false match.

## Validation contract

`validateDrawingIdentityGraph` must check at least:

1. Every declared persistent ID is a canonical UUID.
2. Every declaration UUID is unique drawing-wide.
3. Every required live reference is a canonical UUID.
4. Every required live reference resolves to an allowed target kind.
5. Optional missing references are permitted only by an explicit dormant/external schema rule.
6. Every lineage field is `null` or a UUID.
7. Default Stack and Default Class roles each resolve to exactly one live record.
8. Active Stack/Class references resolve.
9. No persistent `id`/`*Id` field contains a prefix, suffix, sentinel, encoded path, name, or counter.
10. No unregistered extension serializes identity-shaped fields.
11. No declaration is silently replaced during ordinary normalization.
12. Every Insert/clipboard map assigns distinct new live UUIDs to distinct new declarations.

Diagnostics name:

- drawing name/UUID;
- collection or extension owner;
- record type and user-visible name when available;
- offending field path;
- offending value;
- expected target kind;
- repair action or failed operation.

## History and transactional behavior

- History snapshots contain canonical UUIDs only.
- Undo restores the exact prior UUID graph.
- Redo restores the exact originally committed UUID graph.
- A failed operation commits neither new records nor partial remaps.
- A paste/Insert transaction allocates all IDs and validates the graph before changing live state.
- Selection, hover, active Stack/Class, property panels, and paint order preserve references through history by UUID.
- History command labels may contain readable record names; they do not depend on ID prefixes.

## Solver and worker integration

- `SolverModel.js` stops exporting `createStableId(prefix)`.
- Geometry, Parameter, dimension, annotation, and constraint UUIDs enter the solver unchanged.
- Solver variables receive runtime UUIDs with separate owner/coordinate metadata.
- Constraint graph maps use UUIDs for actual variable and persistent constraint identities.
- component membership signatures and intrinsic-equation labels become explicit runtime keys.
- worker protocol snapshots preserve UUID strings exactly.
- worker request correlation uses a protocol token, not a drawing identity.
- solver diagnostics return persistent offending UUIDs plus record type/name supplied by the controller.
- no UUID is generated in a solve loop.

## Module conversion inventory

The implementation pass must inspect and update at least these owners.

### Core identity and IO

- new `IdentitySystem.js`;
- new `DrawingIdentitySystem.js`;
- `DrawingIO.js`;
- `DrawingClipboard.js`;
- `StackClipboardSystem.js`;
- `StackRelationshipSystem.js`;
- `BrowserAutosave.js`;
- `DrawingFileSystem.js`;
- `DrawingHistory.js`.

### Organization and controls

- `StackArchitecture.js`;
- `StackSystem.js`;
- `ClassSystem.js`;
- `ClassTools.js`;
- `CanvasUIControls.js`;
- `ControlTools.js`;
- `ParametersPanel.js`;
- `ParameterTableIO.js`.

### Geometry and feature owners

- `DrawingTools.js`;
- `DimensionSystem.js`;
- `ConstraintSystem.js`;
- `FilletSystem.js`;
- `NotchSystem.js`;
- `ArrayTools.js`;
- `SymmetricTool.js`;
- `SwellGeometry.js` and `SwellTools.js`;
- `SeamLineSystem.js`;
- `SubtractSystem.js`;
- `TextTools.js`;
- `TableTools.js`;
- `ImageSystem.js` and `ImageTrace.js`;
- `BoundaryTopology.js`;
- `CanvasOrigin.js`;
- `CanvasPaintOrder.js`;
- `DocumentVariables.js`.

### Solver

- `solver/SolverModel.js`;
- `solver/ParameterRepository.js`;
- `solver/SolverController.js`;
- `solver/SolverExecutionFacade.js`;
- `solver/ConstraintGraph.js`;
- `solver/ConstraintRegistry.js`;
- solver worker protocol/client/runtime modules;
- Stack solve and diagnostic modules that expose IDs.

`infiniteCanvas.js` may receive only shared identity indexes and narrow callbacks. Feature-specific migration, serialization, or derived-target logic remains in the owning modules.

## Delivery phases

### Phase 0 — Frozen identity inventory and fixtures

- [ ] Record every persistent declaration and reference path in a checked identity inventory.
- [ ] Classify every `id`/`*Id`/`*Ids` field under the taxonomy in this plan.
- [ ] Identify every extension serializer and require an identity descriptor.
- [ ] Capture canonical rendered fixtures containing every supported drawing tool and extension.
- [ ] Capture legacy fixtures covering prefixed, counter, sentinel, derived, cross-Stack, and portable relationship identities.
- [ ] Add a test-only `fixtureUuid(label)` helper so tests use readable deterministic valid UUIDs without weakening production generation.

Exit criteria:

- no serialized identity-bearing path is unclassified;
- every exception is explicitly external or structural and is scheduled for accurate renaming;
- baseline save/open, clipboard, Insert, history, and solve behavior is recorded.

### Phase 1 — Core UUID authority and identity graph

- [ ] Add `IdentitySystem.js` with secure raw UUID-v4 generation and validation.
- [ ] Add `DrawingIdentitySystem.js` with schema registration, indexing, validation, audit, and remapping.
- [ ] Add core drawing/entity/Parameter/constraint/annotation identity descriptors.
- [ ] Add drawing-wide reserved UUID allocation.
- [ ] Add duplicate, dangling, and wrong-target-kind diagnostics.
- [ ] Add CI/build checks preventing production local ID generators.

Exit criteria:

- core identity APIs have exhaustive unit tests;
- collision retry is tested with an injected generator;
- arbitrary drawing strings are never remapped without a descriptor.

### Phase 2 — Canonical drawing, Stack, Class, Parameter, and solver identities

- [ ] Add `drawingId` and `identityArchitectureVersion`.
- [ ] Convert Stack and Class records from sentinels to UUIDs plus `systemRole`.
- [ ] Convert entities, composites/groups, Parameters, Controls, dimensions, constraints, and annotations.
- [ ] Remove `createStableId(prefix)` and all type-prefixed production generation.
- [ ] Convert solver variable IDs to UUIDs and separate coordinate/owner metadata.
- [ ] Rename solver component/equation signatures that are keys rather than identities.
- [ ] Make canonical mutation boundaries reject non-UUID declarations.

Exit criteria:

- the ordinary Line + dimension + constraint + Parameter + Control workflow saves only canonical UUID identities;
- rename/reorder/reparent operations leave UUIDs unchanged;
- solver output and rollback use the same persistent UUIDs supplied by the drawing.

### Phase 3 — Geometry tools and extension-owned identity schemas

- [ ] Convert tool-local factories to the core UUID allocator.
- [ ] Register Array, Linked Copy, Swell, Seam Line, and Stack-relationship schemas.
- [ ] Convert text, table, image, fillet, notch, and grouped geometry creation.
- [ ] Replace derived encoded IDs with stored UUIDs or explicit structured locators.
- [ ] Replace canvas-origin and document-variable pseudo-identities.
- [ ] Replace boundary-cycle, seam-line, fillet-topology, and subtract presentation pseudo-IDs.
- [ ] Ensure every referenceable derived target survives save/open without relying on encoded identity strings.

Exit criteria:

- every supported tool can be created, edited, constrained/dimensioned where supported, saved, reopened, and selected by canonical identity;
- no extension can serialize an unregistered `id`/`*Id` field.

### Phase 4 — IO, migration, clipboard, Insert, and Save As

- [ ] Bump the native drawing schema and add the one-time legacy identity migrator.
- [ ] Replace recursive string remapping with schema-aware graph remapping.
- [ ] Convert DXF-created entities to raw UUIDs on import.
- [ ] Convert clipboard subset creation and paste to one atomic identity transaction.
- [ ] Convert complete drawing/Stack Insert and remove same-ID Stack merging.
- [ ] Convert portable lineage fields to UUIDs.
- [ ] Define intentional semantic reuse maps for globals/Controls/Classes without implicit live-ID reuse.
- [ ] Implement independent Save As/Save Copy graph cloning.
- [ ] Preserve ordinary save/open identity exactly.

Exit criteria:

- inserting the same drawing or subtree twice creates two disjoint live UUID sets;
- internal references in each inserted instance resolve only within the intended graph or explicit destination shared records;
- legacy input is converted once and saved canonically;
- ordinary text and expressions containing UUID-looking strings remain unchanged.

### Phase 5 — History, autosave, UI, exports, and worker protocol

- [ ] Preserve UUIDs through undo/redo and transaction rollback.
- [ ] Separate autosave slot keys from drawing identity.
- [ ] Rename file-format, picker, asset-reference, DOM, pointer, and request identifiers accurately.
- [ ] Preserve UUIDs across solver-worker messages.
- [ ] Ensure SVG/PNG/DXF exporters do not infer domain type from UUIDs.
- [ ] Keep external DXF handles and SVG/DOM IDs outside the drawing identity graph.
- [ ] Update diagnostics and developer views to show type/name plus optional short UUID.

Exit criteria:

- no UI behavior relies on typed ID prefixes;
- autosave recovery and worker solving preserve the exact canonical drawing graph;
- exports remain visually/geometrically unchanged.

### Phase 6 — Remove mixed architecture and enforce the contract

- [ ] Delete every local production ID generator and counter/timestamp fallback.
- [ ] Delete sentinel-ID branches and constants.
- [ ] Delete prefix parsing and typed-ID assumptions.
- [ ] Delete legacy runtime normalization paths.
- [ ] Add a source audit for prohibited ID patterns.
- [ ] Add a serialized identity audit to the build and full test suite.
- [ ] Update `MODULE_INDEX_MAP.md` and schema documentation to identify the sole UUID authorities.

Exit criteria:

- the production source has one UUID generator;
- the live model accepts no mixed IDs;
- all canonical serialized identity declarations and references pass the identity audit;
- all rendered acceptance scenarios pass.

## Test strategy

### Unit tests

- UUID generation and canonical validation;
- secure fallback behavior;
- reserved-set collision retry;
- identity declaration indexing;
- wrong-kind, duplicate, dangling, dormant, and lineage validation;
- descriptor-driven remapping;
- no rewrite of text/expressions/external keys;
- default-role lookup independent of UUID value;
- derived locator versus stored derived identity behavior;
- idempotent legacy migration.

### Integration tests

- create/update/delete every persistent record class;
- save/open identity preservation;
- Save As complete graph remapping;
- duplicate and clipboard remapping;
- drawing and Stack Insert repeated twice;
- global Parameter/Control/Class intentional reuse;
- cross-Stack constraints, dimensions, expressions, and dormant relationships;
- extension-owned Array, Linked Copy, Swell, and Seam Line references;
- solver worker and rollback paths;
- history undo/redo;
- autosave recovery;
- portable image package identity behavior;
- DXF import allocation and export isolation.

### Static/build guards

The identity validation script must reject production occurrences of:

- `createStableId(prefix)` or equivalent prefix-taking factories;
- `Math.random()` in identity creation;
- timestamp/counter identity fallbacks;
- new semantic sentinel IDs;
- unregistered serialized `id`/`*Id` fields;
- production tests/fixtures accidentally entering the application with arbitrary string IDs.

External identifier exceptions are maintained in a narrow reviewed allowlist with the owning system and reason.

## Rendered acceptance scenarios

Completion requires end-to-end verification in the rendered application, not only stored-data or unit-test evidence.

1. Create one of every ordinary geometry type; save and verify all persistent identities are UUIDs.
2. Reopen the drawing and verify every UUID is unchanged and every object remains editable/selectable.
3. Add user Parameters, Controls, driving dimensions, driven dimensions, and constraints; save/open and solve successfully.
4. Rename Stacks, Classes, Parameters, Controls, and geometry labels; verify UUIDs do not change.
5. Verify the Default Stack and Default Class use UUIDs and remain protected by role rather than sentinel value.
6. Duplicate geometry with composite segments; verify every new declaration receives a new UUID and group membership remains correct.
7. Copy/paste geometry with dimensions and constraints into the same Stack; verify new record UUIDs and correct local dimension names.
8. Paste the same package into a different Stack; verify UUID remapping, Stack ownership, qualified expressions, and dimension renumbering.
9. Insert the same drawing twice; verify disjoint live UUID sets and independent editing/solving.
10. Insert the same Stack subtree twice once Stack trees are available; verify parent/child and relationship references remap independently.
11. Create and edit Array, Linked Copy, Swell, Seam Line, fillet, notch, text, table, image, and subtract content; save/open without encoded domain IDs.
12. Dimension or constrain supported derived geometry; save/open and verify the target remains stable.
13. Create a constraint or dimension to canvas origin; save/open using the origin role reference rather than a pseudo-ID.
14. Delete records with cross-references; verify pruning/dormancy diagnostics identify records correctly by type/name/UUID.
15. Undo and redo creation, paste, Insert, deletion, Stack movement, and relationship changes; verify UUID graphs are restored exactly.
16. Trigger a failed solve or failed paste/Insert; verify no partial IDs or references commit.
17. Save As an independent drawing; verify a new drawing UUID and disjoint live record UUIDs while visible content remains the same.
18. Recover from autosave; verify the saved drawing UUID graph is preserved.
19. Open a representative legacy drawing with every mixed-ID category; verify migration, rendered behavior, and canonical resave.
20. Load a deliberately corrupt canonical drawing; verify a precise identity diagnostic and no partial live drawing.
21. Type UUID-looking text into text objects and expression-capable strings; copy/Insert and verify it is not rewritten as an identity.
22. Export DXF, SVG, and PNG; verify rendered/exported geometry is unchanged and external format identifiers remain valid.

## Performance requirements

- Identity migration and remapping are linear in declared records plus declared references.
- Schema traversal must not recursively inspect unrelated arbitrary strings.
- Drawing identity indexes are built once per accepted snapshot/transaction and reused.
- UUID validation occurs at boundaries, not inside numeric solver iterations or render loops.
- UUIDs are never regenerated during solve, redraw, tree rendering, or selection refresh.
- Clipboard and Insert allocate their full map in one pass.
- Benchmark save, open, clipboard, repeated Insert, history restore, and solver setup before and after migration.
- The identity conversion must not regress the Stack-local solve scalability objective.

## Risks and mitigations

### Missed extension reference

Risk: an extension serializes a reference the central graph does not know about.

Mitigation: mandatory extension identity descriptors plus a serialized build audit that rejects unregistered identity-shaped fields.

### Accidental string replacement

Risk: UUID-looking text, expressions, URLs, or external references are rewritten.

Mitigation: schema-aware declarations/references only; remove generic recursive value replacement.

### Derived-target instability

Risk: replacing encoded IDs breaks dimensions or constraints attached to Array, Linked Copy, Seam Line, or Boolean-derived geometry.

Mitigation: classify every derived target before conversion and either promote it to stored UUID identity or persist a structured UUID-based locator.

### Default-record regressions

Risk: code assumes `stack-default` or `class-x` globally.

Mitigation: role-based lookup APIs and static rejection of sentinel literals in domain logic.

### Legacy ambiguity

Risk: duplicate or dangling legacy strings cannot be mapped safely.

Mitigation: target-kind-aware migration, explicit diagnostics, and fail-closed behavior instead of guessing.

### Test fixtures hiding mixed IDs

Risk: tests continue accepting arbitrary strings while production requires UUIDs.

Mitigation: canonical `fixtureUuid(label)` helper, canonical-boundary tests, and a separate explicit legacy-fixture path.

### Debugging readability

Risk: raw UUIDs are less readable than typed prefixes.

Mitigation: diagnostics display record type, human name/handle, schema path, and an optional shortened UUID without changing identity.

### Partial transaction remapping

Risk: references are rewritten before all declarations have new UUIDs.

Mitigation: two-pass allocation/rewrite followed by validation and atomic commit.

## Definition of done

The generic UUID upgrade is complete only when:

- every persistent ParaMagic identity is a raw canonical UUID;
- every persistent internal ID reference contains a UUID and resolves according to its schema;
- every actual runtime object field named `id`/`*Id` uses UUIDs, or the field is accurately renamed as a non-identity key/token/locator;
- Stack, Class, canvas-origin, document-variable, cycle, derived, and presentation sentinels no longer masquerade as IDs;
- record type and name are never encoded in UUIDs;
- one production core module owns UUID generation;
- one drawing identity system owns declaration indexing, validation, migration coordination, and graph remapping;
- each serializing extension owns and registers its identity schema;
- local counter/timestamp/random ID generators are removed;
- save/open preserves identity;
- duplicate, paste, Insert, and independent Save As allocate and atomically remap new identities;
- ordinary text, expressions, URLs, external keys, and exported-format handles are never mistaken for drawing identities;
- the live solver and UI contain no legacy-ID mode;
- all unit, integration, build-audit, performance, and rendered acceptance requirements pass.

