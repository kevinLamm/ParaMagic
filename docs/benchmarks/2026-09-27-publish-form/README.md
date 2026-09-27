# Developer(s) and Publish form verification

- All 1,343 Node tests passed, including Unicode Developer(s) persistence,
  document variable evaluation, text substitution, empty default and clearing.
- Production and GitHub Pages builds passed with the existing bundle-size advisory.
- Actual browser workflow verified in the isolated full app on 127.0.0.1:5174:
  - Developer(s) appears directly below Drawing Description in Drawing Properties.
  - Entered a multiline description and developer names containing Unicode,
    quotes, ampersand and angle brackets; Publish rendered both as literal text.
  - Publish opens an editable form prefilled from current drawing metadata with Submit.
  - Edited both fields and clicked Submit. The form explicitly reported no server
    connection and no publication. Drawing Properties showed both updated values.
  - One Undo restored both prior values. Redo restored both submitted values.
  - Saved and reopened through the production .paramagic serializer/parser; Publish
    showed the submitted multiline description and Developer(s) again.
  - Closing an edited Publish form without Submit discarded its draft.

Repeat using src/tests/fixtures/drawing-description-browser.html on an isolated
Vite server. It supplies Save and reopen test drawing and Load legacy test drawing
helpers. Use the normal Properties and Publish UI for all edits.

Actual upload and server indexing remain unavailable until the server is integrated.
