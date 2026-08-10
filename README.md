# Nivasa

A curated marketplace for premium Bangalore homes — warm editorial aesthetic (stone/cream with a
gold accent). Visitors browse without an account and book a real viewing slot; the curation team
works the resulting enquiries from a dashboard.

The visitor-facing UI is implemented from the Claude Design source `Nivasa Landing.dc.html`. The
backend follows the patterns in the sibling **eventsforge** repo.

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Prisma 6 + Postgres · Clerk · Zod.

## Run it

```bash
npm install
cp .env.example .env.local        # then fill DATABASE_URL / DIRECT_URL

npm run db:deploy                 # apply migrations
npm run db:seed                   # the three homes the design was written against
npm run dev                       # http://localhost:3000
```

Need a database right now? A throwaway one takes a few seconds:

```bash
docker run -d --name nivasa-pg -e POSTGRES_PASSWORD=nivasa -e POSTGRES_USER=nivasa \
  -e POSTGRES_DB=nivasa -p 55432:5432 postgres:17-alpine
# DATABASE_URL=postgresql://nivasa:nivasa@localhost:55432/nivasa?schema=public
docker stop nivasa-pg && docker rm nivasa-pg     # when done
```

> **`vercel env pull .env.local` overwrites that file** with exactly what the Vercel project
> holds — including wiping a local `DATABASE_URL` if the project has none yet. You only need
> `DATABASE_URL`: `scripts/db-env.mjs` derives `DIRECT_URL` from it, or from Neon's
> `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING` when the integration publishes those.

Other commands: `npm run build` · `npm run lint` · `npm run typecheck` · `npm run db:migrate` ·
`npm run db:studio` · `npm run icons`.

## What works end to end

- **Listings** are database rows. The home page server-renders the published collection;
  DRAFT and ARCHIVED listings never leak through a slug someone kept in a tab.
- **Viewing availability is real.** "3 viewing slots left" is `weeklyViewingSlots` minus the
  viewings actually booked that week, the time picker greys out slots someone else has taken, and
  two people racing for the same slot get a unique-index refusal rather than a double booking.
- **Enquiries** (site visit / owner call / message / general) validate server-side, normalize the
  phone to E.164, book the slot in the same transaction, and return a quotable reference.
- **Owner intake** and the **newsletter** persist, with per-IP rate limits on all three.
- **Dashboard** at `/dashboard`: live counts, the next viewings, an enquiry inbox with status
  triage, the owner-intake queue, listing publish/unpublish/archive, and the outbox.

## Tests

```bash
npm run test:e2e         # Playwright; starts its own dev server on :3187
npm run test:e2e:ui      # the same suite, in the watch UI
npm run test:e2e:report  # open the last HTML report
```

**Stop `npm run dev` before running them** — Next 16 allows one dev server per directory, and the
config refuses to start rather than let a second one serve half the routes as 404s.

Playwright end-to-end only — there is no unit runner yet, so `lib/` is covered through the routes
and pages that call it. The suite needs a **local, seeded Postgres and writes to it**: the home
page is server-rendered from the catalogue before any JavaScript runs, so there is nothing a
browser could intercept and no mock-the-network version of these tests exists. Point
`DATABASE_URL` at the docker container above and run `npm run db:seed`; the runner refuses any
database outside localhost unless `E2E_ALLOW_REMOTE_DB=1`.

Every row a test writes is marked and deleted afterwards, because a booked viewing comes out of a
real weekly quota. `e2e/tests/booking.spec.ts` is the interesting one — it pins the double-booking
index, the weekly cap, and the rule that the cap is counted against the week being booked rather
than the week it is today. See the "Tests" section of `CLAUDE.md` for the rest of the reasoning.

## Architecture

```
app/
  page.tsx                server component → the whole published collection
  api/
    properties/…          public reads, including live day availability
    enquiries/…           public writes, rate-limited
    owner-submissions/…
    subscribers/…
    admin/…               Clerk-guarded, requireRole() first statement
  dashboard/…             the team's surface
  sign-in/…
lib/
  auth.ts                 requireRole, withApiErrors, apiOk/apiError, bootstrap
  slots.ts                the IST slot grid and week windows
  viewings.ts             availability maths
  enquiries.ts            create + book, in one transaction
  properties.ts, dto.ts   catalogue reads and what crosses to the client
  admin-properties.ts     catalogue writes
  notifications.ts        the single outbound orchestrator
prisma/
  schema.prisma, migrations/, seed.ts
components/               the visitor UI, ported from the design, plus dashboard/
```

A route handler parses, authorizes, delegates to `lib/`, and shapes the response — nothing else.
Business logic lives in `lib/` so it is callable from a route, a script, or a cron without change.
`CLAUDE.md` carries the invariants worth knowing before editing any of it.

## Setup that is not done yet

**Neon Postgres and Clerk are provisioned through the Vercel Marketplace, and both need a browser
step the CLI cannot drive.** The project is already linked (`girish-hiremaths-projects/namma-nivasa`).

Neon is provisioned and connected. **Its secrets cannot be read by the CLI** — Vercel marks
Marketplace-managed variables non-retrievable, so `vercel env pull` brings the *names* down
with empty values. The connection string has to be copied by hand, once:

1. Vercel dashboard → **Storage** → the **namma-nivasa** database → copy `DATABASE_URL`.
2. Put it in `.env.local` as `DATABASE_URL=…` (replacing the local Docker line).
3. `npm run db:deploy && npm run db:seed`

Clerk is still to add, under **Integrations**. Then visit `/dashboard` and click
**Make me the owner** — it only works while the team is empty.

Nothing needs an unprefixed alias in the dashboard: Neon publishes
`namma_nivasa_DATABASE_URL`, and both `lib/prisma.ts` (runtime) and `scripts/db-env.mjs`
(CLI) resolve a `*_DATABASE_URL` suffix, so deployments work as published.

Use `npm run env:pull` rather than `vercel env pull` directly: the raw command replaces
`.env.local` wholesale and drops local-only values like `NEXT_PUBLIC_APP_URL`. The wrapper
restores those, and deliberately does not restore `DATABASE_URL` — a stale local one pointing
at a container while the app talks to Neon is the worse failure.

Until then the app runs against any Postgres you point `DATABASE_URL` at, and with no Clerk keys
the dashboard is unreachable (503) while the visitor-facing site is unaffected.

## Known gaps before launch

- **No email or SMS provider is wired.** Every notification lands `SKIPPED` and is readable at
  `/dashboard/outbox` — a real queue the team can work by hand, not a stub pretending to send.
  Wiring a messaging integration replaces one function in `lib/notifications.ts`.
- **No image upload.** Photography is URLs a curator supplies; the seed uses Pexels placeholders
  and each image falls back to a hand-drawn SVG if it fails to load.
- **No listing editor UI.** Publish/unpublish/archive is in the dashboard; creating and editing a
  listing goes through `POST`/`PATCH /api/admin/properties`.
- **Rate limiting is in-memory** until `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set — it resets on
  every cold start and does not coordinate across instances.
- **No tests.** eventsforge has vitest + Playwright; this repo has neither yet.
- Testimonials are sample copy, and the RERA number in the footer is a placeholder. Both are
  labelled as such in the UI.
