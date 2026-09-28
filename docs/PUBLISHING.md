# ParaMagic publishing

The editor, local files, and exports require no account. Publishing and My drawings
use ParaMagic accounts created on the first Google or GitHub sign-in. End users do
not sign in to ChatGPT. Google and GitHub identities are separate accounts; matching
email addresses do not link them automatically. Users should return with the same provider.

Owners can download their `.paramagic` files and delete their stored copies. Each
Publish creates a new copy. Discovery starts off: owners must explicitly allow
signed-in users to search a copy's description and open its viewer. Owners can
change that setting in My drawings. Search matches any keyword, ignores case, and
matches within words. Long descriptions are indexed in overlapping chunks.

Other users open a separate viewer with the owner's controls and only PNG/DXF
export. It has no drawing tools, control-authoring interface, local autosave,
ParaMagic/JSON/SVG export, or publishing actions. Control values affect the local
viewing session only. Original-file download and all publication mutations are
checked against the owner on the server. Withdrawing discovery blocks new viewer
loads and export checks; it cannot retract data already delivered to a browser.

This is an application permission model, not copy protection: a browser must
receive drawing data to render and solve it, and a technically skilled visitor
can inspect that data. Do not use this feature as DRM for secret design geometry.

## Enable the testing site

Site: https://paramagic-testing.essdog.chatgpt.site

The existing `.openai/hosting.json` requests Sites-managed D1 (`DB`) and R2 (`DRAWINGS`).
The Worker creates its additive database schema on first use. `wrangler.jsonc` uses
local development binding names; Sites supplies the actual production resources.

In the site's environment settings, configure:

| Variable | Value | Secret |
| --- | --- | --- |
| `APP_ORIGIN` | `https://paramagic-testing.essdog.chatgpt.site` (no trailing slash) | No |
| `STORAGE_LIMIT_BYTES` | `500000000` for the requested 500 MB total; absent or zero pauses new publishing | No |
| `GOOGLE_CLIENT_ID` | Google web application OAuth client ID | No |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Yes |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID | No |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret | Yes |

Only providers with both credentials appear. Enable either or both. Save secrets
directly in Sites settings, never in Git or chat. Redeploy after changing settings.

### Google

Create a Web application OAuth client in [Google Auth Platform](https://console.cloud.google.com/auth/clients).
Configure its branding, audience, and authorized redirect URI:

`https://paramagic-testing.essdog.chatgpt.site/api/auth/google/callback`

During Google's testing mode, add the Google accounts allowed to test the app.
The requested scopes are only `openid email profile`. Follow Google's requirements
for publishing the consent screen before allowing all users.

### GitHub

Create an OAuth app in [GitHub developer settings](https://github.com/settings/developers).
Use the Site as the homepage and this authorization callback URL:

`https://paramagic-testing.essdog.chatgpt.site/api/auth/github/callback`

The app requests `read:user`; it does not request repository access.

Provider references: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[GitHub OAuth](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## Storage cap and uploads

No application-defined maximum drawing size is enforced. Files upload as 8 MiB
chunks and download as one `.paramagic` stream. Browser memory, available total
storage, and platform limits still apply. Images are embedded in the published document.

The cap includes both published data and reservations for unfinished uploads. One
database statement reserves capacity, preventing concurrent users from exceeding
the configured byte cap. Only three unfinished uploads per user may exist at once.
Owners can remove unfinished uploads in My drawings. New publish attempts clean up
up to five uploads idle for over 24 hours. Failed deletion retains its reservation
until object removal succeeds. Storage remains paused if the cap is absent or invalid.

This cap measures drawing payload bytes, not D1 metadata, bandwidth, request counts,
or charges. It is not a billing guarantee or a claimed free-storage allowance.
No admin website or billing account is created by this change. For now the owner
changes the cap in Sites environment settings. Existing downloads and owner deletion
continue to work when new publishing is paused.

## Local development and verification

`npm run dev` supplies local D1 and R2 through Wrangler. To test real OAuth locally,
put credentials and a storage cap in ignored `.dev.vars`; register the matching
`http://localhost:<port>/api/auth/<provider>/callback` with the provider. Use a separate
development OAuth app where a provider permits only one callback. Production requires
an explicit HTTPS `APP_ORIGIN`; only loopback HTTP is permitted without it.

`node --test src/tests/publishingServer.test.js src/tests/publishingClient.test.js`
runs real local D1/R2 integration tests with mocked provider responses and signed
Google test tokens. No network or production data is used.

After `npm run build`, `node scripts/publishing-preview.mjs` serves an isolated
in-memory UI fixture on http://localhost:5180. Its explicit local-account chooser
is only in the preview script, never in the deployed Worker. Stop it to discard
its data. This verifies publishing UI with test accounts; it cannot verify real
Google/GitHub credentials, consent screens, or hosted cookies.

The GitHub Pages build remains a static editor. Its Publish menu directs users to
hosted ParaMagic, where the Worker and storage are available. Local drawing files
can be saved and opened there.

Before declaring live publishing ready, verify on the hosted site: both configured
providers; sign-out; drawing preserved during sign-in; publish with embedded images;
owner download and reopen; owner deletion; a second account denied mutation and
original-file download; discovery on/off; keyword search; viewer controls and
PNG/DXF export; no drawing tools or ParaMagic save in the viewer; and the total cap.
