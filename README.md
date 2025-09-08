# TravelTales Monorepo (React + FastAPI)

This repo contains a Vite React + TypeScript frontend and a FastAPI backend.

## Prerequisites

- Node.js 20.19+ or 22.12+
- Python 3.10+

## Structure

```
app/
  frontend/   # Vite + React + TypeScript + TailwindCSS
  backend/    # FastAPI app
  tests/      # Backend tests (pytest)
```

## Backend (FastAPI)

From `app/backend` (PowerShell):

```powershell
pip install -r requirements.txt
uvicorn main:app --reload
```

Open `http://127.0.0.1:8000/health` → `{ "status": "ok" }`.

Run tests (from `app/` or `app/backend`):

```powershell
pytest -q
```

## Frontend (Vite + React + Tailwind)

From `app/frontend`:

```powershell
npm install
npm install -D tailwindcss postcss autoprefixer @tailwindcss/postcss
npm run dev
```

Open `http://127.0.0.1:5173/`.

Tailwind is configured via `tailwind.config.js`, `postcss.config.js`, and `src/index.css` (contains `@tailwind base;`, `@tailwind components;`, `@tailwind utilities;`). The landing page shows:

```html
<h1 class="text-3xl font-bold underline">TravelTales MVP Running</h1>
```

## Conventions

- For every new backend route, also create a matching test under `tests/` (pytest).
- Use `.env` for secrets (ignored by `.gitignore`).
