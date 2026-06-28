# Connect Gmail / Google Workspace — once and done

This is the only manual setup you ever do for Google in Local Studio. After it,
Local Studio holds a long-lived refresh token that auto-refreshes forever; you
never paste another key or secret.

You do this in two places, one time each:

1. **Google Cloud Console** — create one OAuth "Desktop app" client (gives a
   client ID + client secret). ~5 minutes. Never repeated.
2. **Local Studio** — paste those two values into Settings → Plugins →
   Connections, then click Connect once. Google does a one-time consent, Local
   Studio stores the refresh token, the Gmail/Calendar MCP server installs
   itself. Never repeated.

Why this is safe and stable:
- The OAuth client is type **Desktop app**. Google allows loopback redirects
  (`http://127.0.0.1:<port>`) for Desktop clients with **no registered redirect
  URI**, so the embedded server's port can be anything and nothing breaks.
- The consent screen stays in **Testing** status with your own Google account
  added as a test user. That bypasses Google's sensitive-scope verification
  process. Do not publish the consent screen.
- `access_type=offline` + `prompt=consent` (Local Studio sends these already)
  guarantee Google issues a refresh token on the first consent. The refresh
  token persists as long as it is used periodically; the MCP server uses it
  automatically, so it stays alive.
- The client ID/secret for a Desktop client are not actually secret and never
  rotate. You can re-view them in the console anytime.

---

## Part 1 — Google Cloud Console (one time, ~5 min)

### 1. Open the console and pick a project

1. Go to <https://console.cloud.google.com/>.
2. Top-left project dropdown → **New Project**.
   - Name: `local-studio` (anything).
   - Location: `No organization` (or your personal org).
   - **Create**. Wait for it to finish, then select it.

### 2. Enable the APIs Local Studio uses

Open each link and click **Enable**:

- Gmail: <https://console.cloud.google.com/apis/library/gmail.googleapis.com>
- Calendar: <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com>

(Drive is optional — only enable <https://console.cloud.google.com/apis/library/drive.googleapis.com> if you also want the Drive MCP tools.)

### 3. Configure the OAuth consent screen

1. <https://console.cloud.google.com/apis/credentials/consent>.
2. **User type: External** → **Create**.
3. **App registration → App information**:
   - App name: `Local Studio`
   - User support email: your Google account email
   - Developer contact information → Email: your Google account email
   - **Save and Continue**.
4. **Scopes** step → **Add or Remove Scopes**. Paste these exact scopes into
   the filter box one at a time and tick each:

   ```
   openid
   email
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/gmail.modify
   https://www.googleapis.com/auth/calendar
   ```

   Click **Update** → **Save and Continue**.
5. **Test users** step → **Add Users** → paste your own Google account email
   (the one you will sign in with) → **Add** → **Save and Continue**.
6. Summary → back at the consent screen, confirm **Publishing status:
   In testing**. Do not click **Publish**.

### 4. Create the OAuth client ID (Desktop app type)

1. <https://console.cloud.google.com/apis/credentials>.
2. **+ Create Credentials → OAuth client ID**.
3. **Application type: Desktop app** (this is the important one — not Web).
   - Name: `Local Studio`
   - **Create**.
4. The modal shows your **Client ID** and **Client secret**. Copy both. (You
   can always get them back: Credentials list → the "Local Studio (Desktop)"
   row → edit — the secret is shown in the panel, not hidden-only-once.)

You now have two strings:

```
Client ID     xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
Client secret GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keep them handy for Part 2.

### 5. (Nothing else.) No redirect URI configuration.

A Desktop client has no "Authorized redirect URIs" field. Local Studio uses
`http://127.0.0.1:<embedded port>/api/oauth/google/callback` and Google
accepts any loopback redirect for this client type. You are done in the
console forever.

---

## Part 2 — Local Studio (one time, ~30 sec)

1. Open Local Studio. Go to **Settings → Plugins → Connections**.
2. Under **Google**, paste:
   - **Client ID** → the value from Part 1 step 4.
   - **Client secret** → the value from Part 1 step 4.
   - **Save**. (Local Studio stores these locally; it never sends them
     anywhere except to Google's token endpoint at consent/refresh time.)
3. Status should now read **Ready** (client configured, not yet connected).
4. Go to **Plugins** and find the Gmail / Google Workspace curated plugin.
   Click **Connect**.

   What happens automatically:
   - Local Studio opens Google's consent page in your browser.
   - You pick your Google account, consent to the scopes.
   - Google redirects back to Local Studio's loopback callback.
   - Local Studio exchanges the code for tokens and stores the **refresh
     token** locally.
   - The managed Gmail/Calendar MCP server installs and enables itself using
   the connected token.
   - The browser tab says "Google connected · plugin installed" and closes
   itself.

Done. Status now reads **Connected** with your account email.

---

## After this — nothing

- The refresh token auto-refreshes. You do not click Connect again.
- Restarting Local Studio, the desktop app, or your machine changes nothing.
- Reinstalling Local Studio: the connected credentials live in the app's
  data dir. If you wipe that, re-enter the same Client ID/secret (you still
  have them from Part 1) and click Connect once more — the consent is a
  single click because Google remembers the grant.

## If something breaks

- **"redirect_uri_mismatch"**: you created a Web application client instead of
  a Desktop app client. Delete it and redo Part 1 step 4 with type **Desktop
  app**.
- **"access_denied" / "unverified app" during consent**: you forgot to add
  your Google account email as a test user (Part 1 step 3.5), or you
  accidentally published the consent screen. Add yourself as a test user and
  keep status In testing.
- **Refresh token stops working after months of no use**: just click Connect
  once. Google issues a fresh refresh token. Your Client ID/secret are
  unchanged.
