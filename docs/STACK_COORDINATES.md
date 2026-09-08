# Stack coordinates

Each drawable Stack has a rigid frame `{ x, y, rotation }` in the drawing's global coordinate system. Rotation is in radians. Stack hierarchy organizes the document; each frame is expressed directly in global coordinates.

The solver stores geometry variables in Stack-local coordinates. Canvas geometry and serialized entity coordinates remain global for compatibility with the existing drawing tools and export formats. Loading a drawing converts these coordinates back into the saved Stack frame. Older drawings start with identity frames.

Internal constraints and dimensions use the owning Stack's local coordinates. Horizontal and vertical therefore remain horizontal and vertical relative to the Stack after placement. A local dimension edit still changes local geometry.

Relationships referencing multiple Stacks belong to the permanent Global layer and measure their referenced geometry in global coordinates. Their persisted `solveDomain` records which unknowns may satisfy the relationship.

With no active Stack, constraint and dimension tools create `stack-frame` relationships. The first selected Stack is the reference and the other participant is the moving Stack. These relationships solve only translation X, translation Y, and rotation, so every entity and local annotation in the moving Stack follows the frame without changing local geometry.

All Stacks connected by cross-Stack constraints or dimensions form one Global placement component, including entity relationships created while a Stack was active. A new transform relationship solves every frame in that component while temporarily holding the new relationship's reference Stack. During a canvas drag, every related Stack first receives the pointer translation in real time, including movement along a constraint's free direction, and the dragged Stack is then held while the solver corrects the component against its existing constraints and dimensions. The temporary frame hold is solver state only and is never serialized as a drawing constraint.

With an active Stack, constraint and dimension tools create `entity` relationships. The cross-Stack residual is still evaluated in global coordinates, but the solver changes the participating entities in their owning Stack-local coordinates and leaves Stack frames fixed. The Stack participation graph brings the complete transitive set of related entities into the same solve. Legacy global relationships without `solveDomain` retain `stack-frame` behavior.

Local shape solving runs before placement in reference dependency order when both relationship types exist. Impossible rigid relationships and circular placement dependencies fail explicitly. Failed placement transactions restore geometry, frames, and annotations together. No persistent Fixed constraints are created for numerical stability.

The Global layer cannot be deleted, renamed, disabled, activated for drawing, or used as a parent. Its visibility controls its annotations. New cross-Stack dimensions use Global parameter scope, such as `d1@Global`.

The red/green canvas axes and origin handle follow the active Stack. Without an active Stack they display the global origin and axes. Canvas selection does not activate a Stack; activation is through the Stack list. Ordinary no-active-Stack hover and drag remain whole-Stack interactions. Activating a constraint or dimension tool temporarily exposes individual entities and points across all enabled, visible Stacks.

## Verification

Run `npm test` and `npm run build`. The focused coordinate tests cover rigid placement, active-Stack entity solving, transitive cross-Stack propagation, disconnected geometry, persisted roles, local/global dimensions, rollback, worker frame transfer, protected Global ownership, and rotated DXF dimensions. Array and linked-copy tests cover placement in rotated frames.

The full-app fixture at `/src/tests/fixtures/stack-coordinates-browser` loads `stack-coordinates.paramagic`. Reference is active; Moving contains a rectangle with local horizontal/vertical constraints, a driving dimension, disconnected circle, and text. Use the normal constraint and dimension tools to test:

1. Deactivate every Stack, then add Parallel or Collinear between the reference edge and a rectangle edge. Moving rotates/translates while both local shapes stay unchanged.
2. With no active Stack, activate either Smart Dimension tool. Individual entity and point targets become available across Stacks; after cancelling the tool, hover and drag return to whole-Stack behavior.
3. Activate Reference and add the same cross-Stack relationship. The connected entities change in their local coordinate systems while both Stack frames stay fixed.
4. Select Moving in the list: both axes follow its frame. Canvas double-click does not activate a different Stack.
5. Edit `d1@Moving`: its rectangle changes size along local axes.
6. Add a no-active-Stack driving dimension between Reference (or its origin) and Moving. It appears as `d1@Global`; editing it changes placement without resizing Moving.
7. Add the same dimension with Reference active. Editing it solves the related entity graph without changing either Stack frame.
8. Undo/Redo and **Reload saved drawing** restore solve domains, frames, dimensions, and geometry together.

The reload button serializes the current canvas snapshot through JSON and reloads it with the production drawing loader. Fixture diagnostic console entries record saved frames and relationship ownership alongside the rendered workflow.
