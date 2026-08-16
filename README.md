# chat-app

A realtime chat app: direct and group conversations, friend requests, presence,
seen status and avatar uploads.

Ported from the reference implementation at
[mtikcode/Moji_RealtimeChatApp](https://github.com/mtikcode/Moji_RealtimeChatApp).

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
npm install --legacy-peer-deps
npm run dev
```

Serves on `http://localhost:5173`. `--legacy-peer-deps` is needed because
`emoji-mart` still declares a React 18 peer dependency.

## Environment

`backend/.env` needs `PORT`, `MONGODB_CONNECTION_STRING`, `CLIENT_URL`,
`ACCESS_TOKEN_SECRET` and the three `CLOUDINARY_*` values. The frontend reads
`VITE_API_URL` and `VITE_SOCKET_URL` from `.env.development` and
`.env.production`.
