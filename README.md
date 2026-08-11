# Nivasa

A curated marketplace for premium Bangalore homes — warm editorial aesthetic (stone/cream with a
gold accent). Visitors browse without an account and book a real viewing slot; the curation team
works the resulting enquiries from a dashboard.

The visitor-facing UI is implemented from the Claude Design source `Nivasa Landing.dc.html`. The
backend follows the patterns in the sibling **eventsforge** repo.

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Prisma 6 + Postgres · Clerk · Zod ·
AgentMail · Anthropic SDK · Playwright.

## Run it

```bash
npm install
cp .env.example .env.local        # then fill DATABASE_URL

npm run db:deploy                 # apply migrations
npm run db:seed                   # the three homes the design was written against
npm run dev                       # http://localhost:3000
```

Only `DATABASE_URL` is required. Every other key has a defined unset behaviour — no Clerk keys
means the dashboard answers 503 while the visitor site is unaffected; no AgentMail credentials
means notifications land `SKIPPED` in a readable outbox. `.env.example` documents what each one
turns on.

Need a database right now? A throwaway one takes a few seconds:

```bash
docker run -d --name nivasa-pg -e POSTGRES_PASSWORD=nivasa -e POSTGRES_USER=nivasa \
  -e POSTGRES_DB=nivasa -p 55432:5432 postgres:17-alpine
# DATABASE_URL=postgresql://nivasa:nivasa@localhost:55432/nivasa?schema=public
docker stop nivasa-pg && docker rm nivasa-pg     # when done
```

> **`vercel env pull .env.local` overwrites that file** with exactly what the Vercel project
> holds — including wiping a local `DATABASE_URL` if the project has none yet. `DIRECT_URL` is
> optional: `scripts/db-env.mjs` derives it from `DATABASE_URL_UNPOOLED` /
> `POSTGRES_URL_NON_POOLING` (what Neon publishes) or falls back to `DATABASE_URL`.

Other commands: `npm run build` · `npm run lint` · `npm run typecheck` · `npm run db:migrate` ·
`npm run db:studio` · `npm run env:pull` · `npm run db:setup` · `npm run icons`.

## What works end to end

- **Listings** are database rows. The home page server-renders the published collection;
  DRAFT and ARCHIVED listings never leak through a slug someone kept in a tab.
- **Viewing availability is real.** "3 viewing slots left" is `weeklyViewingSlots` minus the
  viewings actually booked that week, the time picker greys out slots someone else has taken, and
  two people racing for the same slot get a unique-index refusal rather than a double booking.
- **Enquiries** (site visit / owner call / message / general) validate server-side, normalize the
  phone to E.164, book the slot in the same transaction, and return a quotable reference. A
  confirmed viewing offers an `.ics` download built from the instant the *server* confirmed.
- **Owner intake** and the **newsletter** persist, with per-IP rate limits on all three.
- **Outbound email** goes through one orchestrator (`notify()`) that never throws and logs
  `PENDING` before it sends, so the audit at `/dashboard/outbox` never has a gap where a message
  reached a person with no record of it.
- **Inbound email** arrives at `POST /api/webhooks/agentmail` — Svix-verified against the raw
  body — is threaded onto the enquiry it belongs to, and gets a suggested reply drafted by Claude
  from a facts block built out of our own rows. A curator approves or edits it at
  `/dashboard/inbox`; autonomous sending is off unless every condition in `autoSendRefusal()`
  holds.
- **Dashboard** at `/dashboard`: live counts, the next viewings, an enquiry inbox with status
  triage, the owner-intake queue, listing publish/unpublish/archive, the conversation inbox and
  the outbound audit.
- **Extras that need no server**: a printable brochure and a WhatsApp share per home, a voice
  concierge over the catalogue, and a service worker + manifest so the site installs.

## Tests

```bash
npm run test:e2e         # Playwright; starts its own dev server on :3187
npm run test:e2e:ui      # the same suite, in the watch UI
npm run test:e2e:prod    # against a production build rather than `next dev`
npm run test:e2e:report  # open the last HTML report

npm run test:e2e:deployed                                  # read-only, against production
PW_DEPLOY_URL=https://<preview>.vercel.app npm run test:e2e:deployed
```

`test:e2e:deployed` is a separate config with **no database connection and no `webServer`**, so it
cannot write to the deployment it is checking. The main suite cannot be aimed at a deployment —
most of its specs read and write Postgres directly, and Neon's connection string is not
retrievable — so the two are complementary rather than alternatives. See "Testing a deployed
server" in `CLAUDE.md`.

**Stop `npm run dev` before running them** — Next 16 allows one dev server per directory, and the
config refuses to start rather than let a second one serve half the routes as 404s.

Playwright end-to-end only — there is no unit runner, so `lib/` is covered through the routes and
pages that call it. The suite needs a **local, seeded Postgres and writes to it**: the home page
is server-rendered from the catalogue before any JavaScript runs, so there is nothing a browser
could intercept and no mock-the-network version of these tests exists. Point `DATABASE_URL` at the
docker container above and run `npm run db:seed`; the runner refuses any database outside
localhost unless `E2E_ALLOW_REMOTE_DB=1`.

Every row a test writes is marked and deleted afterwards, because a booked viewing comes out of a
real weekly quota. The server under test runs with AgentMail and Anthropic credentials blanked, so
`inbound-email.spec.ts` can drive the real webhook handler without it emailing anyone.
`e2e/tests/booking.spec.ts` is the interesting one — it pins the double-booking index, the weekly
cap, and the rule that the cap is counted against the week being booked rather than the week it is
today. See the "Tests" section of `CLAUDE.md` for the rest of the reasoning.

## Architecture

```
app/
  page.tsx                server component → the whole published collection
  api/
    properties/…          public reads, including live day availability
    enquiries/…           public writes, rate-limited
    owner-submissions/…
    subscribers/…
    webhooks/agentmail/   public and privileged — Svix-verified, no session possible
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
  agentmail.ts            the only file that imports the SDK
  email-threads.ts        inbound threading, and what must never be answered
  reply-agent.ts          the model composes; autoSendRefusal() decides
prisma/
  schema.prisma, migrations/, seed.ts
components/               the visitor UI, ported from the design, plus dashboard/
e2e/                      Playwright specs and their fixtures
```

A route handler parses, authorizes, delegates to `lib/`, and shapes the response — nothing else.
Business logic lives in `lib/` so it is callable from a route, a script, or a cron without change.
`CLAUDE.md` carries the invariants worth knowing before editing any of it.

## Deployment

The project is linked to `girish-hiremaths-projects/namma-nivasa`. **Neon Postgres and Vercel Blob
are provisioned; Clerk is not.** The deployed project holds the `namma_nivasa_*` Neon variables
and `BLOB_READ_WRITE_TOKEN`, and nothing else — no Clerk keys, no `NIVASA_TEAM_EMAIL`, no
`AGENTMAIL_*`, no `NEXT_PUBLIC_APP_URL`. Check with `vercel env ls production` before believing
`.env.local`, which holds local-only values the project has never seen.

**Migrations run in the build**, not by hand: `vercel.json` sets `buildCommand` to
`npm run db:deploy && npm run build`, so a build that cannot reach the database fails before
`next build` rather than shipping an app against an unmigrated schema. Seeding is deliberately not
in that command — `prisma/seed.ts` upserts by slug, and running it every deploy would overwrite
listings a curator had edited.

**Neon's secrets cannot be read by the CLI.** Vercel marks Marketplace-managed variables
non-retrievable, so `vercel env pull` brings their *names* down with empty values. The connection
string has to be copied by hand, once: dashboard → **Storage** → the **namma-nivasa** database →
copy `DATABASE_URL` into `.env.local`, then `npm run db:deploy && npm run db:seed`.

Nothing needs an unprefixed alias in the dashboard: Neon publishes `namma_nivasa_DATABASE_URL`,
and both `lib/prisma.ts` (runtime) and `scripts/db-env.mjs` (CLI) resolve a `*_DATABASE_URL`
suffix, so deployments work as published.

Use `npm run env:pull` rather than `vercel env pull` directly: the raw command replaces
`.env.local` wholesale and drops local-only values like `NEXT_PUBLIC_APP_URL`. The wrapper
restores those, and deliberately does not restore `DATABASE_URL` — a stale local one pointing at a
container while the app talks to Neon is the worse failure.

**The dashboard is unreachable in production until Clerk is added.** `/dashboard` renders "The
team area is not configured" because `isAuthConfigured()` needs both keys and the project has
neither. Note that one of them is `NEXT_PUBLIC_`, so it is inlined at build time — saving the
variables is not enough on its own, the deployment has to be rebuilt afterwards. Once it is:
visit `/dashboard` and click **Make me the owner**, which only works while the team table is
empty.

Nothing above blocks the visitor site, which needs no Clerk and is serving fine.

## Known gaps before launch

- **Clerk is not provisioned on Vercel**, so the deployed dashboard is unreachable. See
  "Deployment" — the `NEXT_PUBLIC_` key means a rebuild, not just a save.
- **`NEXT_PUBLIC_APP_URL` is unset in production**, so `siteUrl()` falls back to
  `http://localhost:3000` and `unusableBaseUrl()` refuses to send anything carrying a link. Set
  it to the real origin before turning email on, or outbound stays blocked for a second reason
  after the AgentMail keys are in.
- **`NIVASA_TEAM_EMAIL` is unset in production**, so enquiry notifications have no destination.
- **Email is wired but not fully configured.** `AGENTMAIL_INBOX_ID` and
  `AGENTMAIL_WEBHOOK_SECRET` are still unset, so nothing sends and the webhook answers 503 —
  the supported no-credentials state, not a broken one. Create the inbox
  (`npx agentmail inboxes create`), point the AgentMail console at
  `https://<domain>/api/webhooks/agentmail`, and paste both values.
- **The reply agent has no key.** `ANTHROPIC_API_KEY` is unset, so inbound mail is recorded and
  visible at `/dashboard/inbox` but arrives without a suggested reply.
- **No SMS provider**, despite every enquiry carrying a normalized phone number.
- **No image upload.** Photography is URLs a curator supplies; the seed uses Pexels placeholders
  and each image falls back to a hand-drawn SVG if it fails to load.
- **No listing editor UI.** Publish/unpublish/archive is in the dashboard; creating and editing a
  listing goes through `POST`/`PATCH /api/admin/properties`.
- **Rate limiting is in-memory** until `UPSTASH_REDIS_REST_URL`/`_TOKEN` are set — it resets on
  every cold start and does not coordinate across instances.
- **No unit tests.** eventsforge has vitest; this repo has Playwright only.
- Testimonials are sample copy, and the RERA number in the footer is a placeholder. Both are
  labelled as such in the UI.
