# ParaMagic Module Index Map

This document provides a comprehensive index of all JavaScript modules in `packages/paramagic-core/src/modules/` (including `packages/paramagic-core/src/modules/solver/`), detailing their exported functions, constants, classes, and primary responsibilities.

---

## 1. Application Core & Viewport

### `IdentitySystem.js`
- **Description**: Sole generic UUID authority. It creates secure independent UUID-v4 identities, validates and normalizes canonical UUIDs, reserves transaction UUIDs, and derives opaque UUID-v5 values for stable runtime or presentation records without encoding semantic data in the UUID text.
- **Exports**: `createUuid`, `createUuidAllocator`, `deriveUuid`, `deriveUuidForKey`, `isUuid`, `normalizeUuid`, `assertUuid`.

### `DrawingIdentitySystem.js`
- **Description**: Schema-aware drawing identity graph coordinator. It indexes declarations, delegates extension identity fields to registered owner descriptors, migrates legacy identities, validates live and lineage references, remaps complete copy/Insert transactions, and clones independent Save As graphs.
- **Exports**: `IDENTITY_ARCHITECTURE_VERSION`, `registerIdentitySchema`, `migrateDrawingIdentities`, `remapDrawingIdentityGraph`, `cloneDrawingIdentityGraph`, `createDrawingIdentityIndex`, `registeredIdentitySchemaKeys`, `identityAudit`, `validateDrawingIdentityGraph`.
- **Architecture contract**: [`GENERIC_UUID_IDENTITY_MIGRATION_PLAN.md`](GENERIC_UUID_IDENTITY_MIGRATION_PLAN.md) defines the universal UUID taxonomy, legacy boundary, copy semantics, validation gates, and acceptance requirements.

### `CanvasViewport.js`
- **Description**: Consolidated canvas viewport subsystem managing zoom bounds, scale clamping, overlap selection cycling (Alt-click cycling through stacked entities and handles), and floating drawing hint tooltips.
- **Exports**:
  - `MIN_CANVAS_ZOOM`: Minimum zoom scale constant (`0.005`).
  - `MAX_CANVAS_ZOOM`: Maximum zoom scale constant (`32`).
  - `clampCanvasZoom(value)`: Clamps requested zoom scale within valid limits.
  - `advanceOverlapCycle(previous, candidates, point, tolerance)`: Cycles selection index for overlapping canvas elements.
  - `createOverlapSelectionCycler(options)`: Factory for managing Alt-click selection cycling over stacked entities/handles.
  - `createDrawingHint(options)`: Factory for floating tooltip hints displaying dynamic lengths and radii.

### `infiniteCanvas.js`
- **Description**: Main interactive SVG canvas orchestrator managing drawing plane rendering, grid lines, camera transformations, selection state, interaction modes, snaps, closed region fills, and constraint solver synchronization.
- **Exports**:
  - `createInfiniteCanvas(options)`: Factory function initializing the canvas controller and returning its public API facade.

### `config.js`
- **Description**: Defines toolbar configuration arrays for drawing tools, constraint tool groups, dimension tools, and default sample entities.
- **Exports**:
  - `drawingTools`: Array of drawing tool labels.
  - `constraintGroups`: Grouped array of constraint types.
  - `dimensionTools`: Array of dimension tool definitions.
  - `sampleEntities`: Default demo geometry entities.

---

## 2. Drawing Primitives & Vector Drafting

### `DrawingTools.js`
- **Description**: Implements creation tools for standard vector primitives (Line, Arc, Polyline, Polygon, Circle, Rectangle, Spline/Curve, Text, Construction), multi-segment line chain creation, and curve control point manipulation (insertion, deletion, remapping).
- **Exports**:
  - `drawingTools`: Array of primitive tool names.
  - `sampleEntities`: Default demo entities.
  - `createDrawingTools(options)`: Factory initializing toolbar event bindings for drawing tools.
  - `addEditableLineChain(options)`: Helper for constructing polyline/polygon line chains.
  - `nearestCurveInsertion(points, target, samplesPerSegment)`: Finds nearest curve segment and interpolation ratio `t` for point insertion.
  - `insertCurveControlPoint(points, target)`: Inserts a new control point into a curve array.
  - `deleteCurveControlPoint(points, index)`: Removes a control point from a curve array.
  - `remapCurvePointIndex(index, edit)`: Remaps control point indices after an insertion or deletion edit.

### `TextTools.js`
- **Description**: Vector text entity creation, font typography properties, inline text editing, SVG text node rendering, parameter expression evaluation formatting, and physical CAD text-height migration. Text entities persist `textHeight` in internal millimetres; legacy CSS-like `fontSize` values migrate at 96 DPI.
- **Exports**:
  - `TEXT_PIXELS_PER_INCH`, `DEFAULT_TEXT_FONT_SIZE`
  - `textHeightInMillimetres(entity, fallbackFontSize)`: Returns an explicit physical text height or migrates a legacy font size to millimetres.
  - `isTextEntity(entity)`: Type check for text entities.
  - `createTextEntity(input)`: Factory creating text entity data model.
  - `rememberTextDefaults(entity)`: Saves last-used font properties as defaults for new text objects.
  - `createTextSystem(options)`: Controller managing text rendering, inline carets, and property updates.

### `SymmetricTool.js`
- **Description**: Toolbar tool for mirroring geometry across a reference centerline axis and creating symmetric geometric constraints.
- **Exports**:
  - `SYMMETRIC_ICON`: SVG icon path string.
  - `createSymmetricTool(options)`: Factory initializing the symmetry tool.

### `ArrayTools.js`
- **Description**: Rectangular and circular pattern array tools, offset and angle computations, placement transforms, array entity materialization, and selection property patches.
- **Exports**:
  - `arrayToolTypes`, `ARRAY_TOOL_ICONS`
  - `arrayDerivedRecordId`, `parseArrayDerivedRecordId`, `arrayPlacementTransform`, `isArrayOriginPlacement`, `arrayDerivedOwnerId`, `materializeArraySubtractOwners`, `normalizeArrayDefinition`, `arraySelectionPropertyPatch`, `migrateArrayDefinition`, `evaluateArrayCountExpression`, `rectangularArrayOffsets`, `circularArrayAngles`, `boundsCentroid`, `evaluateArrayDefinition`, `arrayDependentVisualIds`, `createArrayTools`.

---

## 3. Fillets, Notches & Pattern Features

### `FilletSystem.js`
- **Description**: Consolidated fillet subsystem managing corner detection, arc evaluation math, topology constraint generation, fillet toolbar tools, radius dimension synchronization, and appearance application.
- **Exports**:
  - `isFilletEntity(entity)`: Type check for fillet entities.
  - `evaluateFillet(fillet, entities)`: Solves fillet arc geometry for an intersecting corner.
  - `evaluateFilletedGeometry(entities)`: Computes actual arc geometry for line corners with fillets.
  - `filletTopologyConstraints(constraints, fillets)`: Derives solver topology constraints for fillet arcs.
  - `createFilletSystem(options)`: Factory for the fillet state manager.
  - `createFilletTools(options)`: Toolbar interaction controller for creating fillets.

### `NotchSystem.js`
- **Description**: Consolidated notch subsystem handling notch feature primitives, point projection onto edges, DXF layer mappings, location memory, boundary edge resolution, driving dimension targets, and toolbar interaction controls.
- **Exports**:
  - `DEFAULT_NOTCH_TYPE`, `NOTCH_TYPES`, `notchLength`
  - `isNotchEntity(entity)`: Type check for notch entities.
  - `projectPointToNotchFeature(notch, point)`: Projects a point onto a notch edge.
  - `notchDxfLayer(entity)`: Returns DXF layer name for a notch.
  - `notchGeometryPrimitives(entity)`, `notchGeometryPoints(entity)`: Generates primitive lines/arcs for notch rendering.
  - `createNotchLocationMemory(feature, parameter)`: Creates location memory for notch repositioning.
  - `createNotchBoundaryResolver(options)`: Resolves notch host segment intersections on closed/open boundaries.
  - `createNotchSystem(options)`: Factory initializing the notch subsystem manager.
  - `createNotchTools(options)`: Toolbar tool controller for placing notches on shape boundaries.

### `SeamLineSystem.js`
- **Description**: Consolidated finish-size offset and seam line pattern drafting system for apparel and industrial drafting, including offset math, definition migration, edge keying, and DXF materialization.
- **Exports**:
  - `SEAM_LINE_INSET`: Default seam allowance offset constant.
  - `normalizeSeamLineExtension(extension)`: Normalizes seam line data model.
  - `materializeSeamLineEntitiesForDrawing(drawing)`: Generates seam line offset entities for DXF export.
  - `createSeamLineSystem(options)`: Factory initializing seam line drafting subsystem.
  - `createSeamLinesTool(options)`: Factory initializing seam line tool UI.

### `SubtractSystem.js`
- **Description**: Consolidated Boolean 2D region subtraction subsystem managing 2D region clipping, cutter/target boundary intersections, live subtraction evaluation, derived array cutter materialization, and interactive subtraction creation.
- **Exports**:
  - `isSubtractableEntity(entity)`: Type check for subtractable entities.
  - `subtractDrawingResults(drawing, evaluators)`: Computes active Boolean subtraction shapes for a drawing.
  - `createSubtractSystem(options)`: Factory initializing live Boolean subtraction state manager.
  - `createSubtractTools(options)`: Toolbar interaction controller for performing Boolean 2D subtractions.

---

## 4. Layer Stacking & Image System

### `CanvasPresentation.js`
- **Description**: Shared live-canvas presentation snapshot subsystem. It filters hidden objects and effectively disabled Stacks from the authoritative rendered object layer, fits a portable SVG viewport, and supplies the same geometry to SVG/PNG export.
- **Exports**:
  - `isCanvasPresentationSourceNode(node, stackId)`: Applies whole-drawing or per-stack Value Only presentation filtering.
  - `createCanvasPresentationSvg(options)`, `mountCanvasPresentationSvg(host, options)`: Build or mount a sanitized SVG snapshot from the live canvas object layer.
  - `createMeasuredCanvasPresentationSvg(options)`: Creates a fitted, detached SVG snapshot suitable for file export.
  - `serializeCanvasPresentationElement(svg)`: Serializes the shared presentation SVG without reconstructing geometry.

### `StackSystem.js`
- **Description**: Live Stack-tree state manager. It owns selected-versus-active Stack state, child/sibling creation, reparenting, sibling order, visibility, expression storage, effective ancestor state, record presentation, and subtree lifecycle queries while delegating pure hierarchy rules to `StackArchitecture.js`.
- **Exports**:
  - `STACK_EXTENSION_VERSION`, `STACK_INACTIVE_CLASS`, `STACK_DISABLED_CLASS`, `createDefaultStack`, `entityStackId`, `normalizeStackState`
  - `createStackSystem(options)`: Factory initializing canvas stack state and layer ordering controller.

### `StackTreePanel.js`
- **Description**: Permanent docked Stack-tree UI. It owns keyed semantic tree rows, selection, expansion, keyboard navigation, literal and formula activation controls, rename, subtree actions, cycle-safe before/inside/after drag targets, deletion confirmation, and sidebar resizing without subscribing to object-geometry changes.
- **Exports**:
  - `createStackTreePanel(options)`

### `StackActivationSystem.js`
- **Description**: DOM-independent Stack activation graph and transaction coordinator. It compiles Stack expressions through the shared parameter engine, maintains stable reverse dependencies, derives local/effective enablement, detects unavailable driven sources, static cycles and runtime oscillation, and owns repeated solve/evaluate/activate stabilization plus rollback.
- **Exports**:
  - `effectiveEnabledStackIds(stackState, localStates)`
  - `createStackActivationSystem(options)`
  - `createStackActivationCoordinator(options)`

### `StackArchitecture.js`
- **Description**: Version-4 persistent Stack-tree hierarchy and ownership architecture and the sole legacy-drawing conversion boundary. It distinguishes drawable Stack nodes from non-drawable imported-drawing containers, preserves nullable activation independently from enablement, normalizes parent/order/expression fields, rejects invalid graphs, supplies indexed ancestor/descendant/subtree operations, validates reparenting, migrates legacy drawings, assigns ownership to geometry/dimensions/constraints and extension relationships, and preserves portable lineage.
- **Upgrade contract**: [`STACK_TREE_ACTIVATION_PLAN.md`](STACK_TREE_ACTIVATION_PLAN.md) defines the shipped tree, subtree lifecycle, expression activation, stabilization, presentation, and sidebar behavior.
- **Identity prerequisite**: Implemented by `IdentitySystem.js` and `DrawingIdentitySystem.js`; Stack records and all ownership references use raw UUIDs resolved by role rather than name or sentinel value.
- **Exports**:
  - `STACK_ARCHITECTURE_VERSION`, `DEFAULT_STACK_ROLE`, `STACK_NODE_KIND`, `DRAWING_NODE_KIND`, `createStackId`, `isDrawableStack`, `isDrawingContainer`, `normalizeStackArchitectureState`, `createStackTreeIndex`, `ancestorStackIds`, `descendantStackIds`, `subtreeStackIds`, `validateStackReparent`, `reparentStack`, `reorderStack`, `nextActiveStackId`, `defaultStackId`, `migrateStackArchitecture`, `collectRecordReferences`, `participantStackIds`

### `NamingSystem.js`
- **Description**: Single source of truth for Stack, dimension, user-parameter, and Control naming. It owns validation, whitespace normalization, case rules, Stack suffixes, local `dN` allocation, qualified `dN@Stack Name` display names, and exact expression-symbol rewriting for every creation, rename, migration, insert, relationship, and clipboard workflow.
- **Exports**:
  - `stackNameError`, `normalizedStackName`, `uniqueStackName`, `userParameterNameError`, `dimensionParameterNameError`, `dimensionParameterIndex`, `dimensionCollectionNameError`, `parameterNameError`, `parameterNameKey`
  - `qualifiedDimensionName`, `dimensionDisplayName`, `stackNameById`
  - `nextIndexedParameterName`, `nextAvailableParameterName`, `nextDimensionNameForStack`
  - `replaceExpressionSymbolReference`, `rewriteExpressionSymbolReferences`, `rewriteQualifiedDimensionReferences`

### `StackClipboardSystem.js`
- **Description**: Stack-aware clipboard context subsystem. It records the stable identities of referenced-but-uncopied dimensions, converts local references to portable qualified references, restores bare references when pasted into the owner Stack, and retargets copied qualified references. It delegates every naming rule to `NamingSystem.js`.
- **Exports**:
  - `prepareStackClipboardDimensions`, `retargetStackClipboardDimensions`

### `StackRelationshipSystem.js`
- **Description**: Portable cross-Stack relationship lifecycle subsystem. It records dormant relationship templates when only part of a relationship is copied, binds templates to inserted Stack instances, reactivates complete relationships for every compatible insertion set, and prunes relationships after source Stack removal.
- **Exports**:
  - `createDormantStackRelationships`, `reconcileDormantStackRelationships`, `pruneDormantStackRelationships`

### `ImageSystem.js`
- **Description**: Consolidated image subsystem managing image manipulation transforms (scaling, rotation, flips), perspective warping geometry math, image catalog management with 128 KiB runtime fill/stroke assets, image fill patterns/controllers, and portable Base64 asset embedding.
- **Exports**:
  - `isImageEntity`, `normalizeImageEntity`, `imageAppearance`, `scaleImageFromCorner`, `rotateImageFromPointer`, `flipImageEntity`, `resetImageEntity`, `createImageEntityFromFile`, `createImageManipulation`
  - `isImageFillReference`, `imageFillContentUrl`, `MAXIMUM_RUNTIME_CATALOG_IMAGE_BYTES`, `reduceCatalogImageBlob`, `prepareImageFillContentUrl`, `runtimeCatalogImageInfo`, `normalizeImageFillMode`, `resolveImageFillScale`, `resolveGeometryFillAppearance`, `updateFillAppearance`, `imageFillSelectionProperties`, `imageFillPropertiesMarkup`, `createImageFillPropertyController`, `closedImageFillSelection`, `imageFillPatternDefinition`, `imageFillPatternId`, `createImageFillSystem`
  - `loadImageCatalog`, `uploadCatalogImage`, `removeCatalogImage`, `importPortableCatalogImage`, `createImageCatalog`
  - `validateWarpGuideVectors`, `warpVectorHandlePoints`, `normalizeWarpSettings`, `rebaseWarpSettings`, `enableWarpSettings`, `toggleWarpSettings`, `moveWarpGuideCorner`, `moveWarpGuideVector`, `setWarpDimension`, `formatWarpDimension`, `formatWarpDimensionWithUnit`, `parseWarpDimensionInput`, `perspectiveTransformFromPoints`, `transformPerspectivePoint`, `localPointToSourcePixel`, `calculateWarpPlan`, `projectFullImageWarpBounds`, `warpImageEntity`
  - `collectDrawingImageReferences`, `base64ToBytes`, `embedPortableImageAssets`, `serializePortableDrawingJson`, `serializePortablePackageJson`, `hydratePortableImageAssets`, `parsePortableDrawingText`.

### `ImageTrace.js`
- **Description**: Edge detection and region tracing subsystem converting image pixels to parametric vector polygon shapes using OpenCV.js runtime loading.
- **Exports**:
  - `loadOpenCv()`: Asynchronously loads OpenCV.js runtime into the browser.
  - `normalizeImageTraceSettings(input)`: Normalizes tolerance, detail, and smoothing parameters.
  - `imageWorldToLocalPoint`, `imageLocalToWorldPoint`, `imagePixelToLocalPoint`, `imageWorldToPixelPoint`
  - `prepareImageTrace(entity)`: Loads image onto canvas context for fast pixel reading.
  - `tracePreparedImageRegion(prepared, entity, worldPoint, settings)`: Traces connected opaque pixels and returns vector polygon points.

---

## 5. Topology & Dimensions

### `BoundaryTopology.js`
- **Description**: Consolidated closed boundary resolution and graph cycle topology engine. Finds closed loops across coincident endpoints, builds ordered boundary polygons, and calculates SVG path strings.
- **Exports**:
  - `findClosedGeometryCycles(entities, constraints)`: Graph traversal algorithm returning closed loop cycles.
  - `resolvedBoundaryFeaturesForEntity(entity, boundaryId)`: Extracts segment/arc boundary features from geometry.
  - `reverseResolvedBoundaryFeature(feature)`: Reverses orientation of a boundary feature.
  - `resolvedBoundaryPath(features)`: Constructs an SVG path string `d` from boundary features.
  - `resolveClosedBoundaries(entities, constraints)`: Resolves all closed boundary polygons in a drawing.
  - `resolvedBoundaryForHost(boundaries, host)`: Finds closed boundary associated with a host record.

### `DimensionSystem.js`
- **Description**: Consolidated parametric dimensioning system covering feature target geometry math, leader line layout calculations, interactive dimension node/handle manipulation, driving parameter link management, and smart auto-dimension tools.
- **Exports**:
  - `featureLength`, `featureTargetPoint`, `dimensionFeatureDistance`, `transformDimensionFeatureSet`, `nearestDimensionFeature`
  - `distanceDimensionLayout`, `radiusDimensionLayout`, `angleDimensionLayout`, `mclDimensionLayout`, `dimensionDisplayText`
  - `isDimensionEntity`, `dimensionMode`, `createDimensionRecord`, `updateDimensionNode`, `moveDimensionHandle`, `moveDimensionLine`
  - `createDimensionLinkManager(options)`: Factory managing live solver binding and parameter updates.
  - `candidateFromSelections`, `createSmartDimensionTools(options)`: Factory for smart auto-dimensioning tool state.

---

## 6. Document IO

### `DrawingIO.js`
- **Description**: Document import/export and thumbnail subsystem. Handles JSON schema normalization, DXF CAD R15 serialization and parsing, drawing merging/remapped IDs, and SVG thumbnail rendering. DXF serialization emits Autodesk-compatible R2000 symbol tables, the standard `ACAD` APPID, named-object dictionaries, plot-style metadata, reciprocal model/paper layout links, and fully owned/subclassed entities with layout and lineweight data. It also emits single-line `TEXT` and multiline `MTEXT` on a continuous `Text` layer with model-space heights, alignment, paragraph spacing, resolved parameter fields, and generated font styles.
- **Compatibility gate**: `npm run test:dxf` enforces the portable R2000 structure on every deployment; `npm run test:dxf:autodesk` generates the all-geometry fixture and requires a zero-error AutoCAD Core Console audit. See `docs/AUTODESK_DXF_COMPATIBILITY.md`.
- **Exports**:
  - `normalizeDrawingData(input)`: Ensures standard schema structure for drawing data.
  - `serializeDrawingJson(snapshot, name)`: Serializes drawing snapshot to formatted JSON string.
  - `mergeDrawingDataWithMap(base, inserted, options)`: Merges Stack exports directly or wraps full drawings in non-drawable drawing containers, with remapped IDs and deduplicated parameter names.
  - `mergeDrawingData(base, inserted)`: Convenience wrapper returning merged drawing object.
  - `parseDxf(text)`: Parses DXF CAD text into ParaMagic drawing data.
  - `serializeDxf(snapshot)`: Exports drawing snapshot to DXF R15 text format.
  - `parseDrawingText(fileName, text)`: Auto-detects JSON or DXF format and parses drawing.
  - `DRAWING_CANVAS_BACKGROUND`, `drawingThumbnailVersion`
  - `drawingThumbnailEvaluators`, `materializeThumbnailDrawing`, `orderThumbnailEntities`, `createDrawingThumbnailSvg`, `createDrawingThumbnail`, `drawingThumbnailSvgFromDataUrl`

### `DxfExport.js`
- **Description**: DXF export coordinator. Builds whole-drawing and per-stack export snapshots, retains stack-owned text, excludes construction geometry and symmetry centerlines, materializes Seam Lines and final Boolean subtraction contours before source IDs are replaced, suppresses Boolean operands, and flattens array and symmetric copies into physical export geometry. Derived array and symmetry geometry receives a source-scoped view of the authoritative full-drawing Boolean presentation so every child retains the source object's final outer and hole contours without importing unrelated Boolean results.
- **Exports**:
  - `createStackDxfSnapshot(drawing, stackId, options)`: Produces one stack's flattened DXF geometry snapshot.
  - `createDrawingDxfSnapshot(drawing, options)`: Combines every stack into one flattened DXF geometry snapshot.

### `DxfExportGeometry.js`
- **Description**: Pure DXF geometry preparation. Resolves ordinary and construction-only closed boundaries, replaces every Curve-tool path with globally fitted tangent biarcs that can span multiple curve-control intervals, materializes final Boolean contours, transforms export-only boundary entities, and converts analytic arcs to LWPOLYLINE bulges. Closed paths become closed LWPOLYLINE entities; otherwise Curve-tool paths become open LWPOLYLINE entities. The default curve fitting tolerance is 0.25 internal millimetres.

### `PngExport.js`
- **Description**: PNG export coordinator. Chooses an approximately four-megapixel 1:1, 16:9, or 9:16 frame from the Value Only presentation bounds, requests exact Value Only dimension labels from the solver regardless of the live view mode, preserves the live canvas presentation styles, embeds every raster source before canvas rendering, and applies a white background with at least 50 pixels of fitted padding on every side.
- **Exports**:
  - `pngExportFormatForBounds(bounds)`, `fittedPngExportViewport(bounds, width, height, paddingPixels)`
  - `applyPngValueOnlyDimensionText(root, resolveValueOnlyDimensionText)`
  - `createCanvasPresentationPng(objectLayer, options)`, `serializeCanvasPresentationPng(objectLayer, options)`

### `SvgExport.js`
- **Description**: SVG export coordinator. Serializes the authoritative live-canvas snapshot supplied by `CanvasPresentation.js` and embeds catalog, inserted, blob, relative, and remote image sources so the file is portable and cannot taint the shared PNG raster path; it does not independently reconstruct drawing or array geometry.
- **Exports**:
  - `serializeCanvasPresentationSvg(objectLayer, options)`: Produces a portable whole-drawing or per-stack SVG from the shared canvas presentation.
- **Exports**:
  - `DXF_BOUNDARY_ENTITY_TYPE`, `DXF_CURVE_TOLERANCE`
  - `drawingCurveToDxfSegments(points, tolerance)`: Approximates the rendered drawing curve with tangent-connected line and arc segments.
  - `boundaryFeaturesToDxfSegments(features, options)`: Converts resolved boundary features to ordered analytic DXF segments.
  - `materializeDxfGeometry(drawing, options)`: Replaces non-circular closed objects, construction cycles, Curve-tool paths, and final Boolean contours with export-only boundary entities while suppressing replaced source geometry.
  - `transformDxfBoundary(boundary, transformPoint)`, `dxfBoundaryVertices(boundary, transformPoint)`

---

## 7. Constraint Solver & Parameters (`packages/paramagic-core/src/modules/solver/`)

### `SolverController.js`
- **Description**: High-level Stack-aware solver coordinator integrating Planar System Solver, parameter expressions, geometry bindings, constraint handlers, scoped rollback, transitive participant solving, and offender diagnostics.
- **Exports**:
  - `createSolverController(options)`: Instantiates constraint solver controller.

### `ParameterRepository.js`
- **Description**: Parameter data store handling expression evaluation, unit conversions, dependency sorting, computed-value caching, Stack-local dimension namespaces, qualified case-insensitive `dN@Stack Name` references, and longest-symbol matching for unquoted user parameter names containing spaces.
- **Exports**:
  - `ParameterRepository`: Class managing drawing parameters and mathematical expression evaluation.

### `StackSolveSystem.js`
- **Description**: Pure Stack solve partitioning subsystem. It builds the participant graph, expands edited Stacks to their full transitive relationship set, partitions independent solve groups, and aggregates affected-set results without forcing unrelated Stacks through the solver.
- **Exports**:
  - `buildStackParticipationGraph`, `expandParticipantStackIds`, `partitionStackSolveGroups`, `aggregateStackSolveResults`

### `Units.js`
- **Description**: Length unit definitions, unit conversion factors (mm, cm, m, in, ft), unit normalization, and formatted dimension string parsing/formatting, including quarter-inch and whole-millimeter precision in Value Only driven-dimension display.
- **Exports**:
  - `unitFactors`, `defaultLengthUnit`, `normalizeLengthUnit`, `convertLength`, `valueInUnit`, `formatUnitValue`, `parseUnitValue`, `formatDrivenDimensionValue`, `formatUnitlessValue`.

### `GeometryBindings.js`
- **Description**: Maps canvas primitive entities to solver points and variables, keeping visual canvas shapes in sync with solver state.
- **Exports**:
  - `createGeometryBinding(entity, parameterRepository)`: Creates binding for entity to solver variables.
  - `updateEntityFromBinding(entity, binding)`: Updates entity properties from solved variable values.

### `PlanarSystemSolver.js`
- **Description**: Core geometric constraint solver using Levenberg-Marquardt numeric optimization for geometric constraint equations (Coincident, Distance, Parallel, Perpendicular, Tangent, Equal, Angle, Fixed, etc.).
- **Exports**:
  - `PlanarSystemSolver`: Numeric solver class for 2D constraint systems.

### `Variable.js`
- **Description**: Solver variable data model and unique variable ID generator.
- **Exports**:
  - `createVariable(name, value, options)`: Creates solver variable object.
  - Runtime and persistent identities are allocated through `IdentitySystem.js`; solver variables retain separate owner and parameter metadata.

---

## 8. Utilities & UI Helpers

### `AppearanceExpressions.js`
- **Description**: Resolves parametric color and opacity expressions for visual styling.
- **Exports**:
  - `resolveColorExpression(expression, evaluator)`: Resolves expression to hex color string.
  - `resolveOpacityExpression(expression, evaluator)`: Resolves expression to numeric opacity [0..1].

### `AutoConstraintDetector.js`
- **Description**: Detects candidate geometric constraints (coincidence, horizontal/vertical alignment, tangency) during user drawing interaction.
- **Exports**:
  - `detectAutoConstraints(newEntity, existingEntities, options)`: Returns candidate constraints.

### `ConstraintHandlers.js`
- **Description**: Implements user interactions for adding, toggling, and removing geometric constraints on selected entities.
- **Exports**:
  - `createConstraintHandlers(options)`: Factory managing constraint creation tool handlers.

### `ControlTools.js`
- **Description**: Interactive canvas control widgets (sliders, text inputs, checkboxes) bound to drawing parameters.
- **Exports**:
  - `createControlTools(options)`: Factory initializing parameter control widgets on canvas.

### `DrawingClipboard.js`
- **Description**: System clipboard Integration for copying and pasting drawing entities across canvas instances or files.
- **Exports**:
  - `PARAMAGIC_CLIPBOARD_FORMAT`, `PARAMAGIC_CLIPBOARD_VERSION`
  - `createDrawingClipboard(options)`: Factory for clipboard copy/paste controller.

### `DrawingHistory.js`
- **Description**: Undo/Redo stack manager tracking drawing state snapshots.
- **Exports**:
  - `DrawingHistory`: Class managing undo/redo stack.

### `FloatingPanel.js`
- **Description**: Floating overlay panel position binding and drag constraints.
- **Exports**:
  - `clampTranslatedPanelOffset(panel, offset, options)`: Clamps panel position inside viewport.
  - `bindFloatingPanelDrag(handle, panel, options)`: Enables drag interaction on floating panels.

### `ToolRepeat.js`
- **Description**: Shortcut manager for repeating the last active drawing tool via Spacebar or keyboard shortcuts.
- **Exports**:
  - `rememberRepeatableTool(toolName)`: Stores last used tool.
  - `installToolRepeatShortcut(options)`: Listens for shortcut keys to re-trigger the stored tool.
