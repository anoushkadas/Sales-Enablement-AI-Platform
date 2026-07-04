# Sales Companion — v2 (real sign-in, real knowledge, no invented data)

This version is a small full-stack app: a frontend (the screens you've
seen) plus a backend server that handles sign-in, approval, document
search, and talking to Gemini. The backend exists specifically so:

- Your Gemini API key is never visible in the browser.
- Only emails you've approved can sign in and use the app.
- The AI answers company questions **only** from documents you upload —
  if it's not in what you uploaded, it says so instead of guessing.

There is no invented example data anywhere in this version. Every screen
starts empty and fills in from real use.

---

## Part 1 — Google Cloud setup (do this once)

Google reorganized this part of their console in the last year, so if
you find older tutorials online showing a different layout, follow these
steps instead — they match the current console.

1. Go to **console.cloud.google.com** and create a new project (top-left
   project switcher → "New project"). Name it anything, e.g. `sales-companion`.
2. Make sure that new project is selected in the top-left switcher before
   continuing — easy to skip and configure the wrong project by accident.
3. Go to **console.cloud.google.com/auth/branding** (or navigate to
   "Google Auth Platform" from the left menu). You'll see a "Get started"
   setup wizard.
4. Fill in:
   - **App name**: anything, e.g. "Sales Companion"
   - **User support email**: your email
   - **Audience**: choose **External** (this is the one decision you
     can't easily change later — External is correct for a normal app
     that real people outside your Google Workspace org sign into; pick
     **Internal** instead only if every single person who'll ever use
     this app is on the same Google Workspace domain as you)
   - **Contact email**: your email again
   - Agree to the terms and click through to finish the wizard.
5. Now go to **console.cloud.google.com/auth/clients** (the "Clients"
   tab). Click **+ Create client**.
6. **Application type**: Web application.
7. **Name**: anything, e.g. "Sales Companion web client".
8. Under **Authorized JavaScript origins**, click **Add URI** and add:
   - `http://localhost:3001` (for testing on your own computer)
   - Your real Render URL once you have it from Part 3 below, e.g.
     `https://sales-companion.onrender.com` (you'll come back and add
     this after deploying — that's fine, just remember to do it).
9. Leave **Authorized redirect URIs** empty — this app doesn't use that
   flow.
10. Click **Create**. A box will show your **Client ID** — copy it. (A
    client secret is also generated; this app doesn't need it, since
    sign-in happens entirely in the browser and only the ID token is
    ever sent to your server.)

You now have a Client ID that looks like:
`123456789-abc123def456.apps.googleusercontent.com`

---

## Part 2 — Get a Gemini API key

1. Go to **aistudio.google.com** → **Get API key** → **Create API key**.
2. Copy it. You'll paste it into Render as an environment variable in
   Part 3 — never into any file in this project.

---

## Part 3 — Set up a database (for the Learning Roadmap and Manager features)

This app now saves real data — lesson plans, what you've chosen to keep
on your Learning Roadmap, and manager-to-rep assignments — so it needs a
real database. We recommend **Neon** over Render's own free database,
because Render's free Postgres deletes itself (and everything in it)
after 30 days with no warning that's easy to catch in time. Neon's free
tier has no expiration.

1. Go to **neon.tech** and sign up (free, no credit card).
2. Create a new project — any name, e.g. `sales-companion`.
3. On the project dashboard, find the **connection string** (it looks
   like `postgresql://user:password@host/dbname?sslmode=require`).
   Copy it.
4. You'll paste this into Render as an environment variable in the next
   part — `DATABASE_URL`.

That's the whole setup. The app creates its own tables automatically
the first time it starts up with a valid `DATABASE_URL` — there's no
separate migration step to run.

## Part 4 — Deploy to Render (free tier)


1. Put this whole project folder in a GitHub repository (Render deploys
   from a Git repo). If you've never used Git/GitHub before: create a
   new repository on github.com, then follow GitHub's "upload existing
   project" instructions — you can drag-and-drop the folder in the
   browser, no command line required.
2. Go to **render.com**, sign up (free, no credit card needed for the
   free tier), and click **New** → **Web Service**.
3. Connect your GitHub repo.
4. Set:
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Under **Environment Variables**, add these (this is where your real
   secrets live — never in the code):
   - `GOOGLE_CLIENT_ID` = the client ID from Part 1
   - `GEMINI_API_KEY` = the key from Part 2
   - `DATABASE_URL` = the connection string from Part 3
   - `SESSION_SECRET` = any long random string (mash the keyboard)
   - `NODE_ENV` = `production`
6. Click **Create Web Service**. Render will build and deploy it — first
   deploy takes a few minutes. You'll get a URL like
   `https://sales-companion-xxxx.onrender.com`.
7. Go back to Google Cloud Console → your OAuth client (Part 1, step 8)
   and add that real Render URL to **Authorized JavaScript origins**.
   Save.
8. Open `public/auth-gate.js` in this project, find this line near the
   top:
   ```js
   const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com";
   ```
   replace it with your real client ID, commit, and push — Render will
   auto-redeploy.
9. Visit your Render URL. You should see the sign-in screen.

### One important free-tier quirk
Render's free web services go to sleep after 15 minutes of no traffic,
and take 30-60 seconds to wake back up on the next request. That's a
non-issue for an internal sales tool — just don't be surprised by a slow
first load if nobody's used it in a while.

### The first time someone actually asks the AI something
The very first chat message or document upload will create a "File
Search store" automatically and print something like this in Render's
logs (Render dashboard → your service → Logs tab):

```
Created a new File Search store: fileSearchStores/abc123xyz
IMPORTANT: add this as an environment variable on Render so it survives restarts.
Variable name: FILE_SEARCH_STORE_NAME
Variable value: fileSearchStores/abc123xyz
```

**Do this immediately** — go back to Render → Environment Variables →
add `FILE_SEARCH_STORE_NAME` with that exact value, and save (this
triggers a redeploy, which is fine). If you skip this step, every time
the free instance spins down and wakes back up, it'll create a brand
new empty knowledge store and your uploaded documents will silently stop
being searchable — they won't be deleted, just orphaned in a store
nothing points to anymore.

---

## Part 5 — Approve who can sign in

Open `server/approved-users.js`. Add one email per line:

```js
const APPROVED_EMAILS = [
  "you@gmail.com",
  "teammate@gmail.com",
];
```

Commit and push. Render redeploys automatically. Anyone whose email
isn't on this list will see a clear "not approved yet" message if they
try to sign in — they're never silently let in.

---

## A note on "AQ." API keys

In June 2026, Google switched Google AI Studio over to issuing a new
key format — keys starting with `AQ.` instead of the older `AIza...`
format. This isn't a bug or something specific to your account: Google
confirmed this is an intentional, account-wide migration, and the older
`AIza` format is being phased out entirely (already partially restricted
as of June 19, 2026, fully rejected starting September 2026). Any key
you generate now will be an `AQ.` key — that's expected and correct.

One Gemini File Search method (`importFile`) currently has a confirmed,
unresolved bug where it rejects `AQ.` keys with a 401 error even though
every other File Search method accepts the same key fine. This app
works around that by using a different, single-call upload method
(`uploadToFileSearchStore`) instead of the two-step upload-then-import
flow — it does the same job and isn't affected by the bug. If Google
fixes `importFile` later, no changes are needed here; this app just
keeps using the method that already works.

## Part 6 — How to make someone a manager

There are two ways someone becomes a manager:

**The first manager (automatic).** The very first email listed in
`server/approved-users.js` automatically becomes a manager the first
time they sign in — no extra step needed. This solves the obvious
chicken-and-egg problem: someone has to be the first manager, and the
order of that list is how you control who.

**Everyone else (manual, once you're signed in as a manager).** Right
now there's no admin screen to promote additional managers — the
person who's already a manager promotes others by running one command
directly against the database (this is intentionally simple rather than
building a full admin UI for what should be a rare action):

1. Go to your Neon project dashboard → **SQL Editor**.
2. Run:
   ```sql
   UPDATE users SET role = 'manager' WHERE email = 'teammate@gmail.com';
   ```
   replacing the email with the person you want to promote. They must
   have signed into the app at least once already (their row only
   exists after their first sign-in).
3. They'll see the **Manage team** option in their sidebar the next
   time they load the app.

**Once you're a manager**, click **Manage team** in the sidebar:

1. Type a teammate's email under **Add a report** and click **Add** —
   they must have signed in at least once first, same reason as above.
2. Click their name in the team list to select them.
3. Under **Assign a lesson**, type a topic and click **Generate** — the
   same structured lesson-plan generator reps use, just aimed at
   someone else.
4. Check the parts worth assigning, click **Assign**. It lands directly
   in that person's Learning Roadmap, tagged with your name so they can
   see it came from their manager.

## Part 7 — Upload your real knowledge

Once deployed and signed in, click **Knowledge** in the sidebar and
upload your real sales documents — battlecards, pricing sheets, product
docs, anything. The AI will only use these (plus general sales
technique reasoning for things like roleplay feedback) when answering —
never invented company facts. Uploading takes a little while per
document since each one is indexed before it becomes searchable; you'll
see a status message while that happens.

---

## Part 8 — Turning a lesson into a podcast

Any answer the AI gives in Learn (or any other) mode now has a small
**Text / Podcast** switcher underneath it. Clicking **Podcast** sends
that answer's text to Gemini's text-to-speech model and plays back a
narrated version right in the chat.

A few things worth knowing:

- **It costs a little extra per click.** Text-to-speech is billed
  separately from regular chat — roughly $0.10–$0.30 for a typical
  lesson-length narration on the current pricing. It only runs when
  someone actually clicks Podcast, never automatically.
- **Each answer's narration is generated once and cached** in the
  browser tab for that session — switching back and forth between Text
  and Podcast on the same answer doesn't re-generate (and re-charge) it.
  Refreshing the page clears that cache, same as the rest of this app's
  session-only data.
- **"Video" isn't built yet.** Real AI-generated video (Veo) costs
  roughly $0.40/second — about $36 for a 90-second lesson clip — and
  produces short cinematic footage, not a narrated slideshow, so it's
  the wrong tool for this anyway. The honest, useful version of "video"
  here would be narrated text/bullet slides synced to the same audio
  this feature already generates — a natural next step, not yet built.
- **The voice is fixed for now** (one preset voice, "Kore"). Gemini
  supports many voices and even multi-speaker two-host podcasts; that's
  a small follow-on change to `server.js`'s `/api/podcast` route if you
  want it later, not a redesign.

## What's real vs. what's still a known limitation

**Real and working:**
- Google Sign-In, gated to your approved list
- Document upload and AI answers grounded only in what's uploaded
- Your API key lives only on the server, never the browser
- **Chat history now persists for real**, tied to your account, recorded
  server-side automatically on every exchange across Learn, Practice,
  Coach, and Test — not lost on refresh anymore
- **Active Deals now persists for real** — adding, viewing, and deleting
  a deal all survive refresh and are tied to your account
- **Learning Roadmap persists** — saved lesson parts, their status (not
  started / in progress / done), and who assigned them, all survive
  refresh
- **Manager assignment is real** — roles, who reports to whom, and
  assigned lessons all live in the database too
- **My Analytics shows real course-status counts** — not started, in
  progress, and done, with a pie chart, pulled live from your roadmap
- **Generated PPTs and proposals are saved for real** — every file you
  create from the Generate tab (or the "Create PPT" button under any
  chat answer) is stored in the database, not just streamed down once
  and forgotten. Find them all under History & lookups → Generated
  content, split into a Presentations column and a Proposals column,
  each re-downloadable any time.
- **Custom titles** — the Generate tab now has a title field; leave it
  blank to let the AI name the file from the topic, or set your own.
- **Notes tab** — while reading any saved lesson on the Learning
  Roadmap screen, jot a note right there. Every note lands on its own
  Notes screen in the sidebar, tagged with the lesson topic it came
  from, copyable or deletable.
- **Per-lesson quick checks** — each saved lesson now has a "Quick
  check" button that generates a 3-question quiz grounded only in that
  specific lesson's content (not a general topic) to confirm it
  actually landed, with the score saved.
- **Manager visibility into assignments** — managers can now see every
  lesson they've assigned across their whole team, with each report's
  live status (not started / in progress / done) and an overdue flag,
  on the Manage Team screen. Refreshes automatically every 30 seconds
  while that screen is open — not full real-time, but close enough for
  this without the complexity of websockets.
- **Manager-set due dates** — assigning a lesson now has an optional
  due date field; it's saved per-item, same column the rep's own due
  dates use.
- **Roadmap condensed summary** — a quick count strip (not started / in
  progress / done / overdue) now sits above the full saved-lesson list,
  so you don't have to scroll through every card just to see where
  things stand.
- **Fixed: History & lookups wasn't scrollable.** A wrapper div added
  during an earlier restructuring was missing the flex sizing its child
  needed to actually scroll — it would just clip instead. Fixed.
- **Public website fallback for chat** — if your uploaded Knowledge
  documents don't cover a question, the chat route now automatically
  retries once against the public Pure Storage / Everpure website
  (purestorage.com, everpuredata.com) before giving up. The earlier
  "isn't covered in our materials" message only showed up for some
  questions and not others because Knowledge document search is
  semantic, not a permissions system — there's no per-user difference
  in what's searchable, it just depends on how closely a question's
  wording matches what's actually in the uploaded docs. This fallback
  closes that gap with a second source rather than a flat refusal.
  Note: Gemini's File Search and URL Context tools cannot be combined
  in a single request (confirmed in Google's own docs), so this is a
  genuinely separate follow-up API call, not one bigger request.
- **Upload-to-fill deals** — on the Add Deal form, upload a note, email,
  meeting summary, or brief (PDF, Word, or plain text) and AI extracts
  name, company, owner, people involved, value, timeline, priority, and
  a notes summary. Nothing saves automatically — every field lands in
  the normal form for you to review and edit before clicking Save deal.
  Note: .docx files are converted to plain text on the server first
  (via the `mammoth` library) rather than sent directly to Gemini —
  direct .docx input to Gemini is unreliable in practice (confirmed:
  real "Unsupported MIME type" errors), even though Google's docs list
  it as supported for a different feature (File Search).

**Known limitations, by design, for this version:**
- **Deals are private to whoever creates them.** A manager can't yet see
  a report's deals — every screen in this app scopes data to the
  signed-in user for consistency and a simpler security model. Shared
  visibility (e.g. a manager dashboard of team deals) is a deliberate
  choice to add later, not an oversight.
- **Analytics currently shows roadmap status only** — counts of not
  started / in progress / done courses, with a pie chart, pulled live
  from the same database as the Learning Roadmap screen. Manager call
  scores, time-to-first-deal, and other sales-performance metrics
  aren't tracked anywhere in the app yet, so they're not shown — adding
  them would mean deciding where that data comes from first (manual
  entry, a CRM integration, etc.), not just a display change.
- **No admin screen for promoting additional managers.** It's a direct
  SQL command for now (Part 6) rather than a UI — a deliberate choice to
  keep a rare action simple rather than building a whole admin screen
  for it prematurely.
- **History has no per-deal filter in the UI yet**, even though each
  entry is tagged with the deal it was asked about when relevant (the
  `deal_id` column is there) — filtering by deal is a small follow-on
  to the existing tag filter, not yet wired up.
