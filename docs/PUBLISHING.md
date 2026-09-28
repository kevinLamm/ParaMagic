# ParaMagic publishing

The full editor, local files, and exports require no account. Firebase Authentication
handles all account credentials. ParaMagic offers Google sign-in and its own
email/password sign-up, email verification, password reset and sign-out. GitHub
sign-in is removed. End users do not need a ChatGPT account.

Email users must verify their address before accessing storage. Passwords go directly
to Firebase through its official SDK and never to the ParaMagic Worker or drawing
files. The browser keeps Firebase's sign-in state across visits; Sign out clears it.
The Worker verifies Firebase's signed identity and current account status, then
issues a five-minute HttpOnly session cookie. The client renews this cookie as needed.
Disabling an account or resetting its password blocks renewal; existing cookies can
remain valid for at most five minutes. Stable Firebase UIDs determine ownership,
so linked sign-in methods use the same owner. Email text alone never merges owners.

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

## Authentication setup

Site: https://paramagic-testing.essdog.chatgpt.site

Firebase project: `paramagic-61ae8` (ParaMagic), on the no-cost Spark plan.
[Firebase console](https://console.firebase.google.com/project/paramagic-61ae8/authentication/providers)

Enable Email/Password and Google under Authentication > Sign-in method. Use
ParaMagic as the public app name and the owner's contact as the support email.
Under Authentication > Settings, authorize `paramagic-testing.essdog.chatgpt.site`.
Use the password policy to require at least 15 characters and leave email enumeration
protection enabled. Under Templates, the sender name should be ParaMagic for both
email verification and password resets. Firebase hosts the verification/reset link
pages; successful actions can return users to the testing site.

Register a Web app and put its public configuration in Sites environment settings:

| Variable | Value |
| --- | --- |
| `APP_ORIGIN` | `https://paramagic-testing.essdog.chatgpt.site` |
| `STORAGE_LIMIT_BYTES` | `500000000` (500 MB shared across all drawings) |
| `FIREBASE_PROJECT_ID` | `paramagic-61ae8` |
| `FIREBASE_AUTH_DOMAIN` | The Web app's `authDomain` |
| `FIREBASE_API_KEY` | The Web app's public `apiKey` |

These Firebase Web configuration values identify the project; they are exposed to
browsers by design and do not grant administrative access. Keep the API key restricted
to Firebase's required APIs; HTTP-referrer restrictions would also need to account
for the server's account lookup. No service-account private key is needed. The old
`GOOGLE_CLIENT_*` and `GITHUB_CLIENT_*` environment settings are no longer used.
Redeploy after changing Sites environment settings.

Facebook and Apple can be added through this same Firebase project later. Each needs
its provider configuration and an app button/server allowlist entry. They are not
enabled by this implementation. No Firebase database or drawing bucket is needed.

References: [Google sign-in](https://firebase.google.com/docs/auth/web/google-signin),
[email/password](https://firebase.google.com/docs/auth/web/password-auth),
[verification and resets](https://firebase.google.com/docs/auth/web/manage-users),
[token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens),
[authentication quotas](https://firebase.google.com/docs/auth/limits).

The existing `.openai/hosting.json` requests Sites-managed D1 (`DB`) and R2 (`DRAWINGS`).
The Worker creates its additive database schema on first use. Sites supplies the
production resource bindings.

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

`npm run dev` supplies local D1 and R2 through Wrangler. Put the Firebase Web
configuration and storage cap in ignored `.dev.vars`. Authorize the development
hostname in Firebase only when needed. Production requires an explicit HTTPS
`APP_ORIGIN`; only loopback HTTP is allowed without it.

`node --test src/tests/publishingAuth.test.js src/tests/publishingServer.test.js src/tests/publishingClient.test.js`
runs real local D1/R2 tests with signed Firebase fixture tokens and mocked account
lookups. They exercise verification, revocation, ownership, quota races, discovery
permissions, upload integrity and session renewal without production accounts.

After `npm run build`, `node scripts/publishing-preview.mjs` serves an isolated
in-memory storage UI fixture on http://localhost:5180. Its local account routes
exist only in the preview script and never in the deployed Worker. They do not test
real Google sign-in, email delivery or password-reset links.

The GitHub Pages build remains a static editor. Its Publish menu directs users to
hosted ParaMagic, where the Worker and storage are available.

Before declaring live publishing ready, verify on the hosted site: Google sign-in;
email sign-up and verification; unverified account denied storage; reset email and
new-password sign-in; sign-out; drawing preserved during sign-in; publish with
embedded images; owner download/reopen and deletion; another account denied original
file download and mutations; discovery on/off; keyword search; viewer controls and
PNG/DXF export; no drawing tools or ParaMagic save in the viewer; and the total cap.
