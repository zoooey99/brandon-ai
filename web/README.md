# Brandon Web App

The browser-facing half of [Brandon](../README.md), the AI fitness coach that lives in your texts. This app handles everything that can't happen over iMessage: marketing, onboarding, payment, and an installation-free workout tracker.

## What it does

- **Marketing site**: landing page for [textbrandon.now](https://textbrandon.now)
- **Onboarding**: goals, experience, equipment, and schedule collection; phone verification via Twilio so the iMessage relay can match texts to accounts
- **Plan draft review**: the AI drafts a training program and the user refines it conversationally before subscribing
- **Payments**: Stripe subscriptions (monthly/yearly) with webhook-driven status sync
- **Workout tracker**: a mobile web page Brandon links in his daily text; log sets, weights, and reps with no app install

## Stack

- **Client:** React 19 + TypeScript, Vite, wouter, TanStack Query, Tailwind + shadcn/ui (Radix)
- **Server:** Express + TypeScript, Drizzle ORM
- **Services:** Supabase (Postgres + auth), Stripe, Twilio Verify, OpenAI, PostHog

The Postgres database (Supabase) is shared with the [FastAPI coaching backend](../backend/): this app writes profiles and workout plans; the backend reads them to coach over iMessage.

## Development

```bash
pnpm install
cp .env.example .env   # fill in credentials
pnpm dev               # Express + Vite dev server on :3000
```

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app in development |
| `pnpm check` | Typecheck |
| `pnpm test` | Unit tests (vitest) |
| `pnpm test:e2e` | Playwright end-to-end suite (requires a running app + database) |
| `pnpm build` | Production build to `dist/` |
| `pnpm db:push` | Push Drizzle schema changes |

## Layout

```
client/        React app (pages, components, hooks)
server/        Express API: routes, Stripe/Twilio/Supabase clients, webhooks
shared/        Drizzle schema + zod validation shared by client and server
e2e/           Playwright tests (onboarding → payment → dashboard)
migrations/    SQL migrations
```
