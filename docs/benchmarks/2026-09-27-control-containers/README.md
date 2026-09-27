# Container controls — September 27, 2026

## Behavior

Controls → Edit controls → Add control → Container creates a normal cN parameter.
Its value is TRUE when expanded and FALSE when collapsed. The disclosure arrow
appears outside edit mode. Edit mode always shows every control, including
children of collapsed or conditionally hidden Containers.

Use the drag handle to drop a control on a Container header or its Drop controls
here area. The Move outside all Containers area moves it to the top level.
Dropping before/after a sibling keeps its parent. Containers can be nested;
cyclic nesting is rejected. Removing a Container promotes its immediate children
to the removed Container's parent, retaining order, parameter identities and values.

Visibility follows the existing Controls convention: turn off the eye toggle to
enter a visibility expression. Hiding a Container hides its whole subtree.
Container membership and expansion participate in drawing history and persistence.

## Implementation

The Controls implementation now lives in the owning ControlTools.js module.
CanvasUIControls.js retains a compatibility re-export for existing callers; the
public editor export points directly to ControlTools.js. No canvas coordinator or
solver changes were required. Extension version 4 adds parentContainerId; legacy
controls without membership remain top-level. Identity remapping includes parent
references. Each nested row reads/updates only its own widgets.

## Verification

- All 1,340 Node tests passed, including eight new Container tests.
- Production and GitHub Pages builds passed (existing bundle-size advisory).
- Browser workflow verified in an isolated in-app browser against the full app on
  127.0.0.1:5174, using real clicks, typed edits and pointer drags.
- Added Container through the actual Add control menu and edited its label.
- Dragged Checkbox into Container, then out via the top-level drop area.
- Confirmed Undo restores membership; Undo/Redo restores expansion.
- Confirmed only regular mode has the disclosure arrow; edit mode reveals collapsed children.
- Collapsed Container; inspected c1 FALSE. Expanded it; Parameters showed c1 TRUE
  alongside its label and the other cN parameters.
- Set Container visibility to c2; the external checkbox hid/showed the entire Container.
- Added numeric child Width, moved it into Container and edited its value to 84.
- Nested a second Container via dragging, then moved Width inside it. Verified the rendered hierarchy.
- Reloaded serialized drawing; hierarchy, conditional visibility, collapsed nested
  Container, cN names and Width=84 were retained.
- Removed nested Container; Width=84 moved into the parent. Removed parent;
  Width=84 remained at top level with its c3 identity. No confirmation dialogs.

## Repeat browser checks

Open src/tests/fixtures/control-containers-browser.html through an isolated Vite
server. It starts an empty test drawing and supplies Reload saved Controls and
Inspect Controls state buttons. Use the normal Controls UI for all mutations.
This fixture must not be opened in a tab containing an unsaved drawing.
