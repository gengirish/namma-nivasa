# TODO — primary domain cutover

Opened 11/08/2026. Scope is the move to `namma-nivasa.intelliforge.tech` as the canonical public
origin, and the Clerk work that hangs off it. Broader pre-launch gaps stay in the README under
"Known gaps before launch"; this file is only the domain thread.

Domain settings:
<https://vercel.com/girish-hiremaths-projects/namma-nivasa/settings/domains>

## Done

- [x] **`namma-nivasa.intelliforge.tech` added on Vercel** and serving — `/sign-in` answers 200 on
      it.
- [x] **`NEXT_PUBLIC_APP_URL` set to `https://namma-nivasa.intelliforge.tech`**, Production scope
      only. Deliberately *not* set on Development or Preview: a Development-scoped value gets
      pulled into `.env.local` by `npm run env:pull` and would overwrite the localhost origin, so
      every dev-composed link would point at production. Preview needs nothing — `siteUrl()`
      already falls back to `VERCEL_PROJECT_PRODUCTION_URL`.

## Open

### 1. Redeploy so the new origin is actually in the bundle

`NEXT_PUBLIC_*` is inlined at build time, not read at runtime, so the deployment live right now
still carries the old origin no matter what the env list says. Until a build runs, `siteUrl()`
resolves to the `.vercel.app` host in every brochure link, ICS file and outbound mail.

### 2. Promote Clerk from a development instance to a production one

**Not an allowed-origins problem.** Production is running a Clerk *development* instance
(`pk_test_…`, frontend API `sure-crow-46.clerk.accounts.dev`), and dev instances do not enforce a
domain allowlist — Clerk's API already answers the new domain with
`access-control-allow-origin: https://namma-nivasa.intelliforge.tech`. Sign-in on the new domain
works today. Nothing in the code needs the domain either: `/sign-in` is self-hosted at
`app/sign-in/[[...sign-in]]/page.tsx` and `middleware.ts:47` builds its redirect relative to the
incoming request.

The real gap is that a test instance is serving production. Dev instances cap users, borrow
Clerk's shared OAuth applications, and issue sessions Clerk says not to depend on. Promoting it is
manual, in three places:

- [ ] **Clerk Dashboard** → the app → instance switcher at the top of the sidebar (reads
      "Development") → **Create production instance**, cloning settings from Development so the
      sign-in methods carry over. Give it `namma-nivasa.intelliforge.tech`.
- [ ] **DNS on `intelliforge.tech`** — Clerk then lists ~5 CNAMEs, roughly `clerk.namma-nivasa`,
      `accounts.namma-nivasa`, `clkmail.namma-nivasa` and two `clk._domainkey…` DKIM records.
      Take the exact targets off Clerk's screen; they are instance-specific and a template will be
      wrong. Add them, then hit **Verify** in Clerk.
- [ ] **Vercel** — paste the resulting `pk_live_…` / `sk_live_…` over the Production values of
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`, then rebuild (same
      build-time-inlining reason as above).

Two traps on the way:

- **Social login needs your own OAuth credentials.** Development instances borrow Clerk's shared
  Google/GitHub apps; production instances refuse to, so a client ID and secret have to be created
  and pasted into Clerk. Skip if the instance is email-only.
- **Leave Development and Preview on the `pk_test_` keys.** Pointing them at the live instance
  would drop test sign-ups into the real user table.

The `clkmail` and DKIM records are for Clerk's own transactional mail (verification codes). That
is a separate sender from AgentMail and the two coexist.

### 3. Point the AgentMail webhook at the new domain

`AGENTMAIL_WEBHOOK_SECRET` is unset in production, so `POST /api/webhooks/agentmail` answers 503 —
the supported no-credentials state, since there is no branch that processes an unverified body.
Register the endpoint as `https://namma-nivasa.intelliforge.tech/api/webhooks/agentmail` (the new
domain, not the `.vercel.app` host) in the AgentMail console and save the signing secret to
Production.

`AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX_ID` are already set, so outbound works; this is the
inbound half only.

### 4. Decide whether the `.vercel.app` host redirects

Whichever domain is marked **primary** in Vercel gets the redirect from the other. Confirm the
intelliforge one holds it, so the `.vercel.app` host redirects rather than serving a duplicate
origin — two live origins split the shortlist and recently-viewed stores, which are
`localStorage` and therefore per-origin.

## Notes for whoever picks this up

- **Clerk is not a Marketplace integration here.** `vercel integration ls` shows only Neon. The
  Clerk variables pull back empty because they are flagged Sensitive on the project, which looks
  identical to Neon's non-retrievable Marketplace variables but is a different cause and is
  reversible.
- **Back up `.env.local` before any provisioning `vercel` command.** `vercel env pull` and
  `vercel blob create-store` both rewrite it with exactly what the project holds. `vercel env add`
  does not. `npm run env:pull` is the only path that preserves local-only keys.
- **Pipe env values with `printf '%s'`, not a PowerShell pipe.** `"value" | vercel env add …`
  appends a newline and the CLI stores it — it warns `Value contains newlines`, which is easy to
  miss, and a trailing newline in an origin corrupts every link composed from it.
