# Trace Region: create a child Stack on Apply

## Behavior

Each successful Apply creates one new Stack under the source image's Stack and puts all outline edges in that child. The image remains selected and its Stack remains active. New children use the normal unique Stack names and begin with the source Stack's coordinate frame, preserving the axes used by automatic constraints.

The child and outline form one history action. Failed outline creation restores the previous Stack state. Repeated tracing routes clicks through inactive children while the image trace tool is active; closing the tool restores ordinary hit testing.

## Implementation

- ImageSystem owns trace application, geometry decoration, history coordination, failure cleanup, and trace input routing.
- StackSystem supports initial coordinate frames and optional history/selection behavior for compound creation.
- infiniteCanvas only wires services and exposes its existing shared hit-testing function to the Image tool.
- Solver mathematics and the OpenCV tracing kernel are unchanged.

## Validation

- Installed into the live workspace after the user confirmed the drawing was saved. All four installed files match the browser-tested copy by SHA-256; 58 focused tests passed again after installation.
- Full automated suite: 1,269 passed, zero failures.
- Client build and GitHub Pages build passed; existing large-bundle warnings remain.
- In-app Chromium test on an isolated local server, using direct source aliases to avoid stale dependency bundles.
- Actual pointer actions opened Trace Region, selected a blue region in a rotated/flipped image within a translated/rotated nested Stack, and clicked Apply.
- The visible Stack tree showed Image source remaining active, with Stack 2 and then Stack 3 below it. Both outlines rendered as inactive geometry.
- All created edges belonged to the expected child, and the source image retained its ownership and selection.
- With Auto Constrain on, the applied geometry matched an independent JavaScript reference solve from the trace points and the same constraints within 5.184e-11 drawing units (test threshold 1e-5).
- With Auto Constrain off, a second trace passed through the existing child and matched reference coordinates exactly.
- One Undo removed outline and child together; one Redo restored both. Serialized reload preserved hierarchy, active image Stack, and rendered geometry.
- Unit coverage includes repeated Apply, initial frame inheritance, source ownership independent of active Stack, single-action Undo/Redo, and rejection/exception cleanup.

The browser harness and complete test/build logs are included beside this report. Its fixture is generated locally by scripts/image-trace/measure.js; no user document is modified by the test.
