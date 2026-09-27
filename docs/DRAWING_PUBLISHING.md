# Drawing metadata and future server publishing

Drawing Properties exposes a multiline Drawing Description immediately below its
heading, followed by a single-line Developer(s) field. Document Variables exposes
the same values as DrawingDescription and Developers. Text fields can reference
[DrawingDescription] and [Developers].

## Stored fields

The .paramagic JSON document stores ordinary Unicode strings at:

- documentMetadata.drawingDescription (retains line breaks)
- documentMetadata.developers (free text; no enforced name delimiter)

Older files default both fields to empty strings. Save, Save As, portable
serialization, browser autosave, and history use the existing metadata persistence
path. A future storage service can extract and index these fields without opening
a drawing in the canvas or constructing a solver. Render them as text in search
results. Server search is not implemented yet.

## Publish form

Publish appears after Save As in the main menu. It opens a modal with the current
Drawing Description and Developer(s), both editable, and a Submit button.

The fields are drafts until Submit. Submitting commits both changed values to the
drawing in one undoable operation. Closing without submitting discards the draft.
Drawing Properties continues to apply its own edits immediately.

The current server has no drawing upload API. Submit therefore keeps the metadata
in the drawing and clearly reports that it has not been published because the
server is not connected. It does not send a request or report successful publication.

The form is owned by src/DrawingPublishDialog.js; its fields are shared with
Drawing Properties through src/DrawingMetadataFields.js. src/main.js supplies the
canvas metadata API.

When server storage is implemented, the Submit handler needs a configured
destination, authentication, upload/update semantics, and a confirmed response
before reporting success. Upload the current portable .paramagic document,
including metadata and image assets. Server retrieval and searchable listings
belong to that future integration.
