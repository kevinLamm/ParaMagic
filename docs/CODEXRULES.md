# ParaMagic Code Ownership Rules

These rules are mandatory for feature work and bug fixes.

## Patches

Patches are considered illigal and banned. Only root level updates or upgrades are allowed and encouraged. Explicite permission must be granted before a patch is allowed to be added. No exception.

## Partial Evidence

Partial evidence is not proof of completion in attaining of a goal. Proof must be validated 100%. Completion may not be claimed until every stated acceptance criterion is tested end-to-end in the user-visible workflow, using the supplied repro fixture when provided. Stored data, unit tests, or partial UI evidence cannot substitute for rendered behavior. If any criterion is untested, the task must be reported as unconfirmed—not complete.

## Undoable actions

Actions covered by drawing history must execute immediately. Do not add warning or confirmation modals before an action that Undo/Redo can reverse. Use status or error UI only when the action fails, cannot be reversed through history, or requires information the user has not supplied.

## Solver nullspace gauges

Drawings and connected constraint components are allowed to remain free-floating. The application must never add a persistent `Fixed` constraint or origin relationship merely to make a numerical solve well-conditioned.

When a free-floating component contains unresolved rigid-body translation modes, the solver may hold a deterministic existing point at its current position for the duration of that solve. This gauge is solver-internal state, not drawing state:

- choose the first-created eligible point in the connected component;
- defer to explicit `Fixed` constraints, canvas-origin relationships, fixed variables, and drag locks;
- release every temporary lock in a `finally` path, including failed or cancelled solves;
- never serialize, add to history, display, or count the gauge as a drawing constraint.

A permanent position or origin reference must be created only through an explicit user action.

## Rule Review Checkpoints

Review `docs/CODEXRULES.md` at these checkpoints:

1. At the beginning of a new task or conversation.
2. After context compaction, summarization, or a major task phase.
3. Whenever the user adds, changes, or references a rule.
4. Before implementation begins.
5. Before reporting a task complete.

Do not reread the rules after every prompt when none of these checkpoints has occurred. If it is unclear whether a checkpoint occurred, review the rules before proceeding.

## Tool ownership

Tool-specific behavior belongs in the tool's module. This includes:

- entity creation and normalization;
- tool state and parameter/value behavior;
- tool DOM/widget creation;
- tool-specific pointer, click, double-click, and keyboard behavior;
- tool properties-panel controls;
- tool serialization and migration helpers;
- tool-specific tests.

Examples:

- Controls: `packages/paramagic-core/src/modules/ControlTools.js`.
- Notches: `NotchFeatures.js`, `NotchBoundaryResolver.js`, `NotchSystem.js`, and `NotchTools.js`.
- Seam lines: `SeamLineSystem.js` and `SeamLinesTool.js`.
- Subtract: `SubtractGeometry.js` and `SubtractSystem.js`.
- Text: `TextTools.js`.
- Fillets: `FilletSystem.js` and `FilletTools.js`.

## `infiniteCanvas.js` boundary

`packages/paramagic-core/src/modules/infiniteCanvas.js` is an orchestration layer, not a feature module. It may own only shared canvas infrastructure:

- record registration and lifecycle;
- world/screen transforms and camera behavior;
- shared selection, pan, zoom, and pointer routing;
- shared rendering order and solve scheduling;
- wiring callbacks between a tool module and the solver/history systems.

Do not add a new tool-specific function, branch, DOM listener, property rule, or geometry algorithm to `infiniteCanvas.js`. Do not grow an existing tool branch there to implement a new feature behavior.

When a tool needs canvas services, expose a narrow module API and pass callbacks into the module. The canvas coordinator should call the module; it should not reproduce the module's behavior.

## Required workflow before editing

1. Identify the owning tool module before changing code.
2. If the owning module does not exist, create it before adding behavior to the canvas coordinator.
3. Keep `infiniteCanvas.js` changes limited to callback wiring and shared infrastructure.
4. Add or update tool-specific tests in the owning module's test file.
5. If the requested change appears to require tool logic in `infiniteCanvas.js`, stop and ask for an architectural decision instead of proceeding by default.

## Review guard

Every change that adds a tool-specific branch or function to `infiniteCanvas.js` is an architectural violation, even if the behavior works. Reviewers should reject it and require the behavior to move to the owning module.
