# SSC CGL Mock Test Platform

Standalone React + Vite app containing both the Admin and Student experiences.

## Run locally

```
npm install
npm run dev
```

Open the URL Vite prints (defaults to http://localhost:5173) in Chrome.

- Student experience: the root URL (`/`)
- Admin experience: `/admin`

To build for production: `npm run build` (output in `dist/`), then `npm run preview` to serve that build locally.

## Data

All mocks and questions are stored in the browser's `localStorage`, scoped to
whatever origin you're running on (e.g. `localhost:5173`). This means:

- Data survives refresh and closing/reopening the tab, as long as it's the same browser + same origin.
- Data does NOT sync across different browsers or devices — there's no server. This is a prototype-grade store, not a production database.
- Data from the previous in-Claude version does not carry over automatically — that lived in a different storage backend this standalone app can't reach.

## Admin access

`/admin` is not linked from the student pages — a normal visitor has no
button or menu that leads there — and it's now also behind a password
prompt (see `ADMIN_PASSWORD` near the bottom of `src/App.jsx`).

**Change that password before you deploy this anywhere public.** The default
is `changeme123`.

Be clear-eyed about what this password check actually is: it's a check
running in the browser's own JavaScript. Anyone who opens dev tools and
reads the page's source can find the password in plain text, or simply
skip calling the check entirely. It stops a casual visitor from wandering
into `/admin` or guessing the path — it does not stop someone who
deliberately goes looking. Real protection means a server that checks
credentials *before* ever sending admin data to the browser at all, which
requires a real backend (Supabase Auth or equivalent) that this
client-only app doesn't have. Treat this password as a lock on an
unmarked door, not a vault.

The same limitation applies to test questions: correct answers are present
in the student's browser memory during a live test, because scoring
happens client-side and there's no server to keep them hidden and score
independently. A student who opens dev tools mid-test can find them. This
is a structural limit of a backend-less app, not a bug — closing it
requires the same real backend as the admin auth question.

## Making this publicly available

This app, as-is, CAN be deployed to a real public URL right now — Vercel
hosting doesn't require a database, and this app doesn't use one (it uses
the browser's own localStorage). What that gets you, honestly:

- A real `https://yoursite.vercel.app` URL anyone can visit.
- The student pages work for genuine visitors.
- BUT: every visitor's browser is its own separate, empty storage. Mocks
  you publish from your own admin session live only in YOUR browser. A
  student visiting from their own phone will see "0 tests available" —
  not because anything is broken, but because their browser has never
  been told about your mocks. This is the real ceiling of deploying it
  as-is: it'll look right to you and empty to everyone else.

Getting past that requires a real shared database (Supabase, per the
original project spec) so every visitor's browser reads from the same
source instead of its own local one. That's a genuinely different piece of
work — not a bigger version of this deployment step, a different kind of
step — and needs an environment with real internet access to set up
(Claude Code, not this chat).

### Steps to deploy this exact app as-is (works for you, not yet for other visitors)

1. Create a free account at vercel.com if you don't have one.
2. Push this project to a GitHub repository (Vercel deploys from GitHub):
   - Create a new repository on github.com.
   - In this project folder: `git init`, `git add .`, `git commit -m "initial"`, then follow GitHub's instructions to push.
3. In Vercel: "Add New Project" → import that GitHub repo → it auto-detects Vite → click Deploy.
4. You'll get a live URL in a couple of minutes.
5. Change `ADMIN_PASSWORD` in `src/App.jsx` to something real before this step, not after.

### The step that actually makes it work for other people

Move to Claude Code with this project as the starting point, and have it:
1. Create a real Supabase project (free tier is enough to start).
2. Replace the `localStorage` functions near the top of `App.jsx` with real Supabase database calls — same function names, so nothing else in the app needs to change.
3. Add real Supabase Auth in front of `/admin`.
4. Move scoring server-side so answers never reach the student's browser before submission.
5. Redeploy to Vercel with the Supabase connection configured.

That's the actual finish line for "the public can use this for real."
