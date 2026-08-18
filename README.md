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

Hosting is configured outside this repo (Render's dashboard), so there is no
deploy config here and nothing in CI deploys. CI only tests.

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
