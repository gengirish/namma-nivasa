# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

Nivasa — a curated marketplace for premium Bangalore homes. A small, deliberate collection of
listings; visitors browse without an account and book a real viewing slot; the curation team
works the resulting enquiries from a dashboard.

The visitor-facing UI was implemented from a Claude Design source (`Nivasa Landing.dc.html`);
the backend patterns are lifted from the sibling **eventsforge** repo — see "Related repos".

## What exists

| Area | Files |
|---|---|
| Schema | `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seed.ts` |
| Auth spine | `lib/auth.ts`, `middleware.ts`, `components/clerk-boundary.tsx` |
| Availability & booking | `lib/slots.ts`, `lib/viewings.ts`, `lib/enquiries.ts` |
| Catalogue reads | `lib/properties.ts`, `lib/dto.ts` |
| Catalogue writes | `lib/admin-properties.ts` |
| Owner intake, newsletter | `lib/owner-submissions.ts` |
| Outbound | `lib/notifications.ts` → `lib/agentmail.ts` |
| Inbound & the reply agent | `lib/email-threads.ts`, `lib/reply-agent.ts`, `app/api/webhooks/agentmail/` |
| Public API | `app/api/{properties,enquiries,owner-submissions,subscribers}` |
| Admin API | `app/api/admin/{bootstrap,properties,enquiries,submissions,drafts}` |
| Visitor UI | `app/page.tsx` → `components/nivasa-*`, `components/{home,property,map,list-property}-view.tsx` |
| Client-side extras | `lib/brochure.ts` (printable brochure + WhatsApp share), `lib/ics.ts`, `lib/voice.ts` → `components/voice-concierge.tsx`, `lib/persisted-ids.ts` (shortlist/recent stores), `lib/graphics.ts` |
| Shared spine | `lib/prisma.ts`, `lib/api-response.ts`, `lib/validations.ts`, `lib/rate-limit.ts`, `lib/site-url.ts`, `lib/content.ts`, `lib/types.ts` |
| Dashboard | `app/dashboard/*`, `components/dashboard/*` |
| PWA | `public/manifest.webmanifest`, `public/sw.js`, `scripts/generate-icons.mjs` |
| E2E tests | `playwright.config.ts`, `e2e/tests/*.spec.ts`, `e2e/support/*` |
| Deployed smoke | `playwright.deployed.config.ts`, `e2e/smoke/*.spec.ts` — read-only, no database |

**Not built — do not assume these exist:**

- **No SMS provider.** Email goes through AgentMail (see "Email" below); nothing sends SMS,
  despite every enquiry carrying a normalized phone number.
- **No image upload.** `Property.heroImageUrl` / `PropertyImage.url` are URLs a curator supplies.
  The owner-intake form records *how many* files an owner has, never the bytes.
- **No listing editor UI.** `/dashboard/properties` can publish, unpublish and archive; creating
  and editing a listing goes through `POST`/`PATCH /api/admin/properties` (or the seed).
- **No unit tests.** There is a Playwright E2E suite (see "Tests" below); there is no vitest,
  so `lib/` is covered only through the routes and pages that call it.

## Commands

```bash
npm run dev              # Next.js dev server on :3000
npm run build            # prisma generate && next build
npm run lint             # eslint (flat config)
npm run typecheck        # tsc --noEmit
npm run icons            # regenerate public/icons/*.png

npm run test:e2e         # Playwright — starts its own dev server on :3187
npm run test:e2e:ui      # the same suite in Playwright's watch UI
npm run test:e2e:headed  # headed browsers, same dev server
npm run test:e2e:prod    # against a production build rather than `next dev`
npm run test:e2e:report  # open the last HTML report
npm run test:e2e:deployed # read-only smoke against a deployed server (no database)

npm run db:migrate       # prisma migrate dev    (all db:* go through scripts/db-env.mjs)
npm run db:deploy        # prisma migrate deploy — production, never `db push`
npm run db:seed          # prisma/seed.ts — idempotent, upserts by slug
npm run db:studio

npm run env:pull         # vercel env pull, preserving local-only keys
npm run db:setup         # env:pull + migrate deploy + seed, for a fresh environment
```

Env lives in `.env.local`, not `.env` — Next reads it, and the `db:*` scripts read it explicitly
through `scripts/db-env.mjs` because the Prisma CLI does not. See `.env.example`.

**Migrations run inside the Vercel build**, via `buildCommand` in `vercel.json`:
`npm run db:deploy && npm run build`. That is the only place they *can* run unattended — the
Neon connection string is non-retrievable (see below), so a deploy is the one context that holds
a working one. `scripts/db-env.mjs` needs no `.env.local` to do it: the file is optional, real
environment wins, and `pick()` resolves both the `namma_nivasa_` prefix and the unpooled URL that
`directUrl` requires. A build that cannot reach the database fails before `next build`, which is
the intended order — shipping an app against an unmigrated schema is how production came up
answering 500 to every route once already. Seeding is deliberately *not* in this command:
`prisma/seed.ts` upserts by slug, so running it on each deploy would quietly rewrite listings a
curator had edited.

**Neon’s connection string cannot be pulled.** Vercel marks Marketplace-managed variables
non-retrievable, so `vercel env pull` writes their names with **empty values** — 28 of 37 on
this project. The string is copied from the dashboard by hand. Do not spend time automating
that; it is a platform limit, not a missing flag.

**Neon prefixes what it publishes** with the resource name (`namma_nivasa_DATABASE_URL`), so an
exact-name lookup fails on a healthy deployment. Two places resolve the `*_DATABASE_URL` suffix
and they must stay in step: `lib/prisma.ts` for the running app (it passes `datasourceUrl`,
overriding the schema’s `env(DATABASE_URL)`) and `scripts/db-env.mjs` for the Prisma CLI,
which cannot see application code.

**It is not only `vercel env pull` that overwrites `.env.local`.** `vercel blob create-store`
does it too, as a side effect of linking the new store — and so do other provisioning
subcommands. The file it leaves behind holds exactly what the Vercel project holds, which is how
a local-only `CLERK_SECRET_KEY` gets destroyed by a command that appears to be about file
storage. Copy `.env.local` somewhere before running any `vercel` command that provisions
something; `npm run env:pull` is the only path here that preserves local-only keys.

**`vercel env pull .env.local` overwrites that file.** It writes exactly what the Vercel project
holds, so a local-only `DATABASE_URL` is wiped whenever the project has none. Neon also does not
publish a variable named `DIRECT_URL` — it publishes `DATABASE_URL` (pooled) and
`DATABASE_URL_UNPOOLED`. `scripts/db-env.mjs` exists for exactly that: it derives `DIRECT_URL`
from the first of `DIRECT_URL` / `DATABASE_URL_UNPOOLED` / `POSTGRES_URL_NON_POOLING` /
`DATABASE_URL`, so no one has to re-add a line by hand after every pull. Do not put `DIRECT_URL`
back into the `db:*` scripts as a required variable.

A throwaway Postgres for local work:

```bash
docker run -d --name nivasa-pg -e POSTGRES_PASSWORD=nivasa -e POSTGRES_USER=nivasa \
  -e POSTGRES_DB=nivasa -p 55432:5432 postgres:17-alpine
docker stop nivasa-pg && docker rm nivasa-pg     # when done
```

## Architecture

A single **Next.js 16 App Router monolith** — no separate backend. API logic lives in Route
Handlers under `app/api/`; business logic lives in `lib/` and must be callable from a route, a
script, or a future cron without change. Postgres via Prisma 6. Deployed on Vercel.

A route handler does four things and nothing else: parse → authorize → delegate to `lib/` →
shape the response. **If a handler contains a `prisma.$transaction`, the logic is in the wrong
file.**

Every handler is wrapped in `withApiErrors()` (`lib/auth.ts`), which is what makes "you cannot
forget the session check" true: `requireRole()` *throws*, and the wrapper is the only thing that
turns a throw into a response. It maps `AuthError` → 401/403/503, `DomainError` → its own status,
Prisma `P2002` → 409, `P2025` → 404, an unreachable database → 503, and anything else → a generic
500 with the detail logged server-side. Handlers return through `apiOk(data)` / `apiError(msg,
status)`; the `ApiResponse<T>` union lives in `lib/api-response.ts`.

### Viewing availability — read this before touching Viewing

The design's "3 viewing slots left" was a constant in a data file. Here it is
`Property.weeklyViewingSlots` minus the viewings actually on the books for that week.

**The double-booking guard is a unique index, not a read.** `Viewing` carries
`@@unique([propertyId, scheduledFor])`. Two visitors who load the picker at the same moment both
see the slot open, both INSERT, and Postgres refuses one with `P2002` — which
`lib/enquiries.ts` turns into "Someone just took that slot". Checking "is it taken" and
inserting afterwards leaves exactly the window that matters. Do not add that check.

**The weekly cap is a count, and can be raced past by one.** That is a deliberate trade, not an
oversight: overshooting a soft weekly target by one costs an owner a phone call, whereas the
double-booking the unique index prevents costs two people arriving at the same door.

**The cap is checked against the *target* week, not the current one.** `weekOf(scheduledFor)`,
never `weekOf(now)` — a booking three weeks out must not be refused because this week is full.
The card badge is the current week by design, so on a Sunday a listing can read "3 slots left"
while next week is full. Both statements are true; the copy says "this week" for that reason.

A cancelled viewing keeps its row and its slot. Cancelling does not free the time until an admin
deletes it — an owner who was already told about a visit should not have the same hour resold
from under them by the next visitor to load the page.

### Time — Asia/Kolkata is a constant, and that is the one shortcut

`lib/slots.ts` hardcodes `IST_OFFSET_MINUTES = 330`. India has had no daylight saving since 1945,
so this is exact rather than approximate. **If this ever serves a second country, every function
in that file needs a real zone argument, not a different constant.**

Everything crossing the wire or the schema is a UTC instant. IST appears only where a human picks
or reads a time. Every `DateTime` column is `@db.Timestamptz(3)`; Prisma's bare `DateTime` is
zoneless `timestamp(3)`, and comparing that against `now()` resolves through the session
`TimeZone` GUC — which on an Asia/Calcutta cluster reads freshly written rows as already past.
Availability sits inside exactly that kind of comparison. The rule is all-or-nothing: a *mixed*
schema is the trap, because the next query written against a zoneless column reintroduces the bug
silently.

### Money

Paise, integer, never a float — the convention from eventsforge. **But `pricePaise` is `BigInt`,
not `Int`.** Prisma's `Int` is INT4, which caps at ₹2.15 crore; that is inside the range of an
ordinary Bangalore listing, so `Int` there is not a tight fit but a column that rejects the second
seeded home. This was found by running the seed, not by reading the schema. INT8 costs four bytes
and removes the ceiling; reading it back as a JS `number` stays exact well past any real price.

### Auth boundaries

`middleware.ts` decides exactly one thing: does this request need a signed-in Clerk user. It uses
`createRouteMatcher`, but only for that question — **authorization never happens there**, because
a path pattern that drifts from real routing leaves a route silently unguarded. Default posture is
PUBLIC; the protected set (`/dashboard`, `/api/admin`) is explicit and everything else falls
through.

Authorization is `requireRole()` in `lib/auth.ts`, called as the **first statement** of every
protected handler. Roles are ranked, never compared for equality:
`OWNER (3) > CURATOR (2) > VIEWER (1)`, so `requireRole("CURATOR")` admits OWNER and CURATOR. A
new role added to the enum without a rank is a type error, not a silent bypass. The `Admin` row —
not a Clerk session claim — is the source of truth, because claims are cached in the token and go
stale for up to a minute after a demotion.

`grep -rn "requireRole\|requireSession" app/api/` enumerates every guarded route.
`POST /api/admin/bootstrap` is the sole exception — its whole point is a Clerk user with no
`Admin` row — and it is rate-limited, only fires while the table is empty, and checks that
emptiness *inside* the transaction so two concurrent callers cannot both become OWNER.

**With no Clerk keys the app still boots.** Middleware degrades to a pass-through and
`requireRole()` refuses everything with a 503, so the dashboard is unreachable rather than
unguarded. `ClerkProvider` is mounted per-segment in `components/clerk-boundary.tsx`, never at the
root, so the visitor-facing site never loads an auth client.

**Visitors have no accounts, and that is a product decision.** An enquiry is identified by a
reference (`NIV-XXXXXX`) and a phone number. Do not add visitor auth without revisiting it.

### Notifications

All outbound communication goes through `notify()` in `lib/notifications.ts`. It **never throws** —
its callers are enquiry paths where an exception costs a lead somebody actually typed in. The log
row is written `PENDING` *before* any send and finalised after, so a crash leaves a visible "we
may have sent this" rather than a message that reached a real person with no record of it. That
log id is also the AgentMail idempotency key, which is what makes a retried send reach a person
once.

**An enquiry about a home CCs that home's owner.** `Property.ownerEmail` is nullable and the CC
is dropped when it is unset, so a listing the curation team sources itself still notifies only
the team. A `GENERAL` enquiry names no property and therefore copies nobody. `copiesFor()`
strips the primary recipient and de-duplicates before sending, because `NIVASA_TEAM_EMAIL` and an
owner's address being the same value is ordinary configuration, not a mistake — and nobody should
receive one enquiry twice for it.

CC rather than BCC on purpose: the team and the owner both need to see who else got it, or they
answer the same visitor twice. `NotificationLog.cc` records what was actually sent rather than
recomputing it, because an audit that re-derives its recipients from today's listing answers a
different question than the one asked. **`ownerEmail` is never rendered to a visitor** — the
`publicSelect` allowlist in `lib/properties.ts` does not include it, and `PropertyDto` has no
such field.

### Email — AgentMail, and what the agent may do alone

`lib/agentmail.ts` is the only file that imports the SDK; everything above it works in terms of
its `SendResult` union. **With `AGENTMAIL_API_KEY` or `AGENTMAIL_INBOX_ID` unset the app behaves
exactly as it did before a provider existed** — every notification lands `SKIPPED` with the
reason recorded and `/dashboard/outbox` is a readable outbox. That is the supported no-credentials
state, not a broken one.

Inbound mail arrives at `POST /api/webhooks/agentmail`. It is **the only route that is public and
privileged** — no session, and none possible. Three things there are load-bearing:

- **The raw body is verified, not the parsed object.** `req.text()` before anything else; Svix
  signs bytes, and re-serialising JSON changes them.
- **No `AGENTMAIL_WEBHOOK_SECRET` means 503.** There is no branch that processes an unverified
  body. With autosend on, that branch would let anyone reach a visitor's inbox.
- **It answers 200 to almost everything.** A non-2xx asks Svix to redeliver. That is right for
  "I cannot verify you" and wrong for "stored, but the model timed out" — the second would
  re-run a failed model call forever against a message already on disk.

**Idempotency is `EmailMessage.providerMessageId @unique`, not a read** — same reasoning as the
double-booking index. And `AgentDraft.inReplyToId @unique` is what makes a retry self-healing: a
delivery that died between storing the message and writing the draft leaves a message with no
draft beside it, which is precisely the state the retry detects and finishes.

**The model composes; it never decides.** `lib/reply-agent.ts` hands Claude a facts block built
from our own rows and asks it to answer using only those. What happens to the answer is settled
in ordinary code by `autoSendRefusal()`. Autonomous sending needs *all* of: `NIVASA_AGENT_AUTOSEND=1`,
an intent on a three-entry whitelist, confidence ≥ 80, the model asserting it answered entirely
from the facts, and the thread's budget of `AUTO_SEND_BUDGET_PER_THREAD` unspent. Anything else
waits at `/dashboard/inbox`. A model classifying its own message as safe is not a safety control,
so nothing lets it choose.

**Rescheduling and cancelling are deliberately off the whitelist.** A moved slot means an owner
has already been told something that is no longer true, and no email should imply otherwise.

**Mail loops are the failure mode to fear.** `unanswerableReason()` in `lib/email-threads.ts`
refuses to answer our own inbox, bounce/no-reply local parts, and anything AgentMail labelled
spam or unauthenticated. Everything it refuses is still *recorded* and still visible — it just
does not get answered.

`/dashboard/inbox` is the conversation; `/dashboard/outbox` is the outbound audit. They are
separate tables on purpose: "did we tell the team about this lead" and "what did this person
actually ask" are answered by different people for different reasons.

### Data flow into the visitor UI

`app/page.tsx` is a server component that loads the whole published collection and hands it to
`<NivasaApp properties={...} />`. One payload for a deliberately small catalogue, so switching
between homes costs no round trip. **Availability inside the booking picker is fetched live**
(`GET /api/properties/[slug]/availability?date=…`) because that is the part that changes while a
visitor is looking at it.

The shortlist and recently-viewed lists are `localStorage`, keyed by **slug, not id** — they have
to survive a reseed or a restore, neither of which preserves a cuid.

## Tests

Playwright only, in `e2e/`. `npm run test:e2e` starts its own `next dev` on **:3187** and drives
it — no separate step, and never the server on :3000, because a suite that quietly tested
whatever was already running (against whatever database it was started with) is worse than one
that refuses to start.

**They need a real database, and they write to it.** `app/page.tsx` is a server component that
loads the whole catalogue before any JavaScript runs, so there is no request a browser could
intercept — mocking the network would leave the page under test showing nothing. Point
`DATABASE_URL` at the throwaway container and seed it. `e2e/global-setup.ts` refuses any host
outside localhost unless `E2E_ALLOW_REMOTE_DB=1`, and refuses to start if the catalogue is unseeded.

Six things are load-bearing and non-obvious:

- **Stop `npm run dev` first.** Next 16 allows one dev server per directory, and a second one
  still prints "Ready" and still binds its port — it just answers the HTML 404 document for every
  route the first has not compiled. That surfaces as `SyntaxError: Unexpected token '<'` on an
  endpoint that works when you curl it, moving between runs. `playwright.config.ts` reads
  `.next/dev/lock` and refuses to start rather than let that happen; `test:e2e:prod` has no such
  restriction, and `PW_BASE_URL` points the suite at a server that is already running.
- **`localhost`, not `127.0.0.1`.** Next 16's dev server will not serve `/_next/static` to an
  origin it was not started on. The page still server-renders, so a suite pointed at the IP passes
  every static assertion and fails every interactive one, with nothing in the console saying why.
  Related: `global-setup.ts` asks for every API route once, because a route being compiled on
  first request can answer 404 before it is ready.
- **Every test waits for hydration** (`expectHydrated`, keyed on React's `__reactFiber$`). The
  whole visitor site is one server-rendered document whose navigation, filter and shortlist are
  client state: every control looks final before hydration and swallows a click that lands early.
- **One worker.** Rate limiting is isolated per test by a unique `x-real-ip` (which is also what
  `getClientIp()` prefers, and `api-public.spec.ts` pins that precedence). The weekly viewing cap
  cannot be isolated that way — it is shared state on a real listing — so bookings run serially.
- **Every row a test writes carries a `PWE2E-<testId>` marker** and is deleted afterwards, because
  a booked slot comes out of a real weekly quota. `Viewing` cascades from `Enquiry`, so deleting
  the enquiry gives the hour back. Global teardown sweeps what a crashed run left behind.
- **The server under test runs with AgentMail and Anthropic credentials blanked** and a pinned
  webhook secret — `E2E_SERVER_ENV` in `e2e/support/env.ts`, injected via `webServer.env`.
  `inbound-email.spec.ts` drives the real handler, and the real handler's next step is to call a
  model and then email whatever address the payload names. Blanking makes that impossible rather
  than unlikely, and pinning the secret makes the signed cases behave the same on a machine with
  an AgentMail account and one without.
- **Dates and slots are computed through `Intl`, never imported from `lib/slots.ts`.** That file
  hardcodes `IST_OFFSET_MINUTES = 330` and the booking flow rests on it; a test reusing the same
  constant would agree with a wrong one. `e2e/support/ist.ts` resolves Asia/Kolkata against tzdata
  instead, which is what makes the assertion on `Viewing.scheduledFor` worth anything.

`e2e/tests/booking.spec.ts` is the one to read first — it is where the double-booking index, the
weekly cap, and the target-week rule are actually pinned down.

### Testing a deployed server

**The main suite cannot be pointed at a deployment, and `PW_BASE_URL` is not the missing piece.**
Seven of the eleven specs talk to Postgres directly, so `global-setup.ts` needs `DATABASE_URL` to
be *the same database the server under test is using*. Neon's string is non-retrievable through
`vercel env pull`, so that pairing cannot be made from a developer's machine — and if it could,
the write specs would create real enquiries and spend the real weekly viewing quota on a real
listing. `webServer.env` is also skipped when `PW_BASE_URL` is set, so `E2E_SERVER_ENV` stops
applying and `inbound-email.spec.ts` signs against a secret the deployment does not have.

`npm run test:e2e:deployed` is the answer instead: `playwright.deployed.config.ts` +
`e2e/smoke/*.spec.ts`, **no `globalSetup`, no database connection at all**, and no `webServer` —
so it cannot write to production and cannot silently fall back to a server it built itself. It
covers the catalogue against its own API, live availability, the admin boundary, the webhook's
refusal and the PWA assets. It does *not* cover booking, the double-booking index, the weekly cap
or the reply agent; those need a database and stay the main suite's job.

One trap it is already built against: **Vercel's deployment-protection wall answers 401 with a
JSON body**, so a status-code assertion alone passes against a login page that never reached the
app. The webhook check asserts our own `{success:false,error}` envelope and the HTML check asserts
the real `<h1>` for that reason. Pointing the suite at a protected preview URL fails all nine
tests rather than passing a few — which is the behaviour to preserve if you add to it.

## Conventions

- Money: paise (`BigInt` for prices, `Int` elsewhere), displayed `₹` with `en-IN`. Never floats.
- Dates: DD/MM/YYYY display, ISO in DB, `Timestamptz(3)`, Asia/Kolkata for display.
- Phone: normalized to E.164 on the way in (`lib/validations.ts`). Four spellings of one number
  must collide, so `Enquiry.phone` is a usable index.
- Migrations: `prisma migrate deploy` in production, never `db push`.
- Rate limiting: `rateLimitAsync()` on every public POST. Use `getClientIp()`, which prefers
  `x-vercel-forwarded-for` / `x-real-ip` — the leading entry of `x-forwarded-for` is
  caller-controlled, and rotating it would hand an attacker a fresh bucket per request.
- Listings are **archived, never deleted**. `Enquiry.propertyId` is `ON DELETE SET NULL` and
  `propertyName` is snapshotted, so an enquiry still reads correctly a year later.
- Marketing copy and label maps live in `lib/content.ts`, not inlined in components.
- Styling is inline, as the design source was, so each component reads like its source. What
  inline styles cannot express — keyframes, breakpoints, `:hover`, the paper grain — lives in
  `app/globals.css` as `.nv-*` classes.
- DTOs (`lib/dto.ts`) are chosen field by field. Adding a schema column never silently ships it
  to a browser.

## Related repos

Patterns here are lifted from **eventsforge** (`../eventsforge`): `src/lib/auth.ts` is the model
for the authorization spine and `withApiErrors`, `src/lib/rate-limit.ts` for `getClientIp`, and
its `prisma/schema.prisma` header for the timestamptz rule. Prisma is pinned to **6.x** to match
it — Prisma 7 moves datasource URLs into `prisma.config.ts` and requires a driver adapter, which
would split the two codebases for no gain here.
