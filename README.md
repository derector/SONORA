# SONORA

SONORA is a music discovery and listening platform. This repository starts as a production-minded monorepo with a web application and API foundation.

## Current status

- Web: Next.js App Router + TypeScript + Tailwind CSS
- API: Node.js + TypeScript + Fastify
- Database: PostgreSQL (schema and migrations are the next implementation step)
- Authentication, catalog providers, playback rights, recommendations and social features are planned, not yet implemented.
- No commercial music is bundled or redistributed by this repository.

## Requirements

- Node.js 22+
- npm 10+

## Development

```bash
npm install
npm run dev
```

The web app runs on http://localhost:3000 and the API on http://localhost:4000.

## Environment

Copy `.env.example` to `.env` and configure values when the corresponding services are provisioned. The app can start without optional external integrations.

## Workspace

- `apps/web`: responsive SONORA web experience
- `apps/api`: HTTP API and health endpoint
- `packages/config`: shared TypeScript configuration

## Product principles

1. Only stream audio from sources whose terms grant the required playback rights.
2. Keep secrets server-side and validate all external input.
3. Treat recommendations as explainable ranking signals, not fabricated AI output.
4. Build accessibility, responsive layouts and observability into the foundation.
