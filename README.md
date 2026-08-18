# chat-app

A realtime chat app: direct and group conversations, friend requests, presence,
seen status and avatar uploads.

## Stack

- **backend** — Express 5, Mongoose, Socket.IO, JWT access tokens with opaque
  refresh tokens stored in a `Session` collection, Cloudinary for uploads.
- **frontend** — React 19, Vite, TypeScript, Zustand, Tailwind v4, shadcn/ui.

## Running it

Backend:

```bash
cd backend
cp .env.example .env   # then fill in the placeholders
npm install
npm run dev
```

Serves on `http://localhost:5001`, with API docs at `/api-docs`.

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Serves on `http://localhost:5173`. `--legacy-peer-deps` is no longer needed —
`@emoji-mart/react` still declares a React 18 peer, but `package.json` now
overrides that one peer specifically, so a plain `npm ci` resolves.

## Environment

`backend/.env` needs `PORT`, `MONGODB_CONNECTION_STRING`, `CLIENT_URL`,
`ACCESS_TOKEN_SECRET` and the three `CLOUDINARY_*` values. The frontend reads
`VITE_API_URL` and `VITE_SOCKET_URL` from `.env.development` and
`.env.production`.

`MONGODB_DB_NAME` is optional. If the connection URI has no database in its
path, Mongoose silently falls back to `test` — which is where the deployed data
actually lives. Set this to pin it explicitly; leave it empty to keep whatever
the URI says. Either way the backend logs the database it resolved to on
startup, so you never have to guess which one you are pointed at:

```
INFO MongoDB đã kết nối — database "test"
```

## Deploying

Two separate hosts, and they do **not** deploy together:

- **frontend** — Vercel (`chat-app-longbi.vercel.app`), root directory `frontend`
- **backend** — Render (`chat-app-backend-tgcb.onrender.com`), configured in
  Render's dashboard, so there is no config for it in this repo

Nothing in CI deploys anything. CI only tests.

### Render service settings

These live in the Render dashboard and are **not** in the repo, deliberately.
A `render.yaml` Blueprint was tried and removed: connecting the repo to a
Blueprint created a *second* backend service alongside the hand-made one rather
than adopting it, leaving the original still serving the URL the frontend calls.
If you reintroduce one, disconnect the Blueprint from any service you intend to
keep managing by hand.

This is a monorepo and there is **no `package.json` at the repo root** — there
never has been. So the Root Directory must point at the package being deployed,
exactly like Vercel's is set to `frontend`:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/health` |

Leaving Root Directory empty makes the build run at the repo root, where there is
no `package.json` to read, so it fails — and a failed deploy leaves the previous
instance serving, which looks from outside exactly like a deploy that changed
nothing.

If Build or Start currently reach into the subdirectory themselves (`cd backend
&& …`, `--prefix backend`), change all three together, or they will resolve to
`backend/backend`.

Environment variables come from the dashboard, not a `.env` file — `npm start`
uses `--env-file-if-exists`, which no-ops when the file is absent. `PORT` is
provided by Render. `CLIENT_URL` must be the deployed frontend origin
(`https://chat-app-longbi.vercel.app`), not localhost, or CORS and the Socket.IO
origin check will reject the real frontend.

Health Check Path must be `/health` if it is set at all. Every other path under
`/api` goes through the global auth middleware and answers 401, which Render
reads as an unhealthy instance — it then rolls back to the previous deploy, and
the old build carries on serving.

**Deploy the backend before the frontend.** The backend tolerates an older
frontend; the reverse is not true. A new frontend against an old backend loses
realtime entirely — it emits `conversation:subscribe` and listens for
`message:new`, neither of which an older server knows — and every endpoint added
since returns 404.

Vercel's Git integration is currently **disconnected**, because it auto-deployed
on push while Render did not, which inverted that order and broke production.
Re-enable it only once Render is deploying too:

```bash
vercel git connect
```

`frontend/vercel.json` then keeps `main` from deploying on push, so reconnecting
does not by itself re-arm the trap. Remove that block when both sides really are
meant to ship together.

That file also holds the install and build commands, which used to live only in
Vercel's dashboard:

- `npm ci` rather than `npm install --legacy-peer-deps` — the peer conflict is
  fixed properly by the `overrides` block in `package.json`, and `npm ci` builds
  strictly from the lockfile.
- `npm run build` rather than `tsc --skipLibCheck && vite build`. The old command
  typechecked **nothing**: bare `tsc` in this directory resolves the
  solution-style root `tsconfig.json`, whose `"files": []` matches no input. The
  script runs `tsc -b`, which does.

The backend needs **Node 22 or newer** — `npm start` uses
`--env-file-if-exists`, which arrived in Node 20.12. `backend/package.json`
declares this in `engines`, which is what Render reads to pick a version. On an
older Node the process exits immediately with `bad option`, the deploy fails,
and the previous instance keeps serving — so from the outside nothing appears to
have changed. Check the Render deploy log, not the site, to tell a failed deploy
from a successful one.

To confirm what is actually running, ask it:

```bash
curl -s https://chat-app-backend-tgcb.onrender.com/health
```

`/health` is public and reports the deployed commit — Render sets
`RENDER_GIT_COMMIT` automatically. A `commit` that does not match `git rev-parse
HEAD` means the deploy did not land, whatever the dashboard says.

**Run the migrations before the new backend serves traffic.** They are
deliberately not run on boot — several instances booting at once would run them
concurrently, and a slow one would block the deploy:

```bash
cd backend && npm run migrate
```

All three are idempotent, so running them twice is safe and is how you verify
them: the second run should change nothing. They point at whatever
`MONGODB_CONNECTION_STRING` is set, so check you are aimed at the right database
before running.

None of the three is a prerequisite for correctness — `getRole()` falls back to
`group.createdBy`, so the app behaves correctly before the role backfill. They
fix a mis-typed index that makes every conversation query a full scan, and
backfill `role` and `lastReadAt`.

Deploy order matters when the two sides ship separately: the backend tolerates
the older frontend, so ship the backend first.
