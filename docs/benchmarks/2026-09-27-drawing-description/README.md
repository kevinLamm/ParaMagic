# Drawing Description and Publish verification

- All 1,342 Node tests passed, including multiline metadata roundtrip, expression
  access and legacy-file default tests.
- Production and GitHub Pages builds passed with the existing bundle-size advisory.
- Actual browser workflow verified on an isolated app at 127.0.0.1:5174:
  - Publish appears between Save As and Drawing Properties in the main menu.
  - Drawing Description is a multiline field immediately below the properties heading.
  - Entered three lines including an accented character, ampersand, angle brackets
    and quoted text; all appeared as literal text in Document Variables.
  - Edited DrawingDescription in Document Variables, returned to Drawing Properties
    and confirmed that both editors show the same updated value.
  - Undo restored Revision B text; Redo restored Revision C text.
  - Serialized a .paramagic document using the production serializer, reopened it
    with the production parser and confirmed the description in the rendered dialog.
  - An older document without this field showed a blank description.
  - Publish displayed the server-not-connected message. No upload API exists yet.

Repeat with src/tests/fixtures/drawing-description-browser.html on an isolated
Vite server. The fixture provides Save and reopen test drawing and Load legacy test
drawing buttons; all description edits and menu actions use the normal app UI.
