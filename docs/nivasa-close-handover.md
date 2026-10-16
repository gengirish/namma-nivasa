# Nivasa Close — handover for Claude Code

Read this alongside `CLAUDE.md`. Everything in `CLAUDE.md` still holds; this file only adds the new feature and the decisions behind it. Where they disagree, `CLAUDE.md` wins and you should say so.

**First session: plan only.** Read `CLAUDE.md`, `prisma/schema.prisma`, `lib/auth.ts`, `lib/notifications.ts`, `lib/reply-agent.ts`, `lib/brochure.ts`, `app/api/admin/uploads/route.ts` and `e2e/tests/booking.spec.ts`. Then come back with an implementation plan (migration, files, routes, tests) and the open decisions in section 9 answered or flagged. No code until Girish approves the plan.

---

## 1. Why this exists

Nivasa's flow today ends at "connect the buyer with the owner" (`Enquiry` → `Viewing` → `CLOSED`). The hardest part of a Bangalore resale starts after that, and in a direct, zero-brokerage deal nobody owns it. No broker drafts the MOU or chases the seller's bank.

Girish just lived this selling his own Sobha Dream Gardens flat (an assignment of a builder Agreement to Sell, with an SBI home loan). What went wrong is the spec:

- **The seller's bank was the bottleneck.** The List of Documents (LOD) took 9 days from the first email. The conditional NOC was still pending 4 days later. The buyer refused to sign the MOU until she had the LOD.
- **The MOU went through five drafts.** Errors caught by the parties, not the drafter:
  - execution date earlier than the token-payment date it acknowledged
  - a 60-day deadline computed from the wrong date
  - a notices clause relying on emails that appeared nowhere in the document
  - possession only in the non-binding annexure
  - "booking amount" ₹5 L in one clause and ₹4 L in another
  - "Assignment Deed" in one clause, "Assignment Agreement" everywhere else
  - a blank date in the annexure
  - the companion LOU naming the wrong project's owners association
  - the LOU making the buyer liable for past dues while the MOU made the seller indemnify them
- **Money was spread across several payments:**
  - token, then booking, then self-funding on the assignment day
  - 1% TDS split across two seller PANs
  - the seller's loan paid off directly by the buyer's bank
  - a balance to the sellers
  - Nobody had a single reconciled view of it.
- **A seller-side ₹3 L penalty applied on non-performance,** while the bank-delay extension needed "mutual agreement". The seller carries the bank's delay risk.

## 2. Product decision

**Nivasa Close** is a deal room for direct owner–buyer transactions. It covers milestones, generated documents, a consistency check, and a money ledger.

- **For Nivasa's own deals first.** It's also offered later to any Bangalore owner–buyer pair who found each other elsewhere. Every seller who uses Close is an owner-supply lead, and owner supply is Nivasa's real constraint.
- **Not for brokers or channel partners.** Nivasa's promise is zero brokerage. A broker tool under this brand contradicts it. If brokers are ever served, it's a separate white-label brand, out of scope here.
- **Concierge first.** Slice 1 is curator-operated from `/dashboard`. Owners and buyers don't log in, which keeps the product decision in `CLAUDE.md`: visitors have no accounts. Parties get documents and updates by email through `notify()`.
- **Monetisation is not in this slice.** A flat per-deal fee comes later and needs a legal check first (see section 9).

## 3. Slice 1 scope (two weeks)

| Priority | Item |
|---|---|
| Must | `Deal` with parties, playbook-driven milestones, deadline countdown, status |
| Must | Deal sheet: structured facts (parties, property, amounts, dates, loan, builder) entered or confirmed by a curator |
| Must | Extraction assist: curator pastes a WhatsApp export or notes text; the model proposes deal-sheet fields; the curator confirms. The model never writes to the deal directly |
| Must | Deterministic document rendering from the deal sheet: MOU (assignment variant), LOU, and three bank emails (conditional NOC + LOD request, foreclosure request, follow-up) |
| Must | `checkDealConsistency()`: a pure function that blocks rendering a final MOU while there are errors |
| Must | Money ledger with reconciliation to the sale consideration |
| Must | Daily cron that emails the curator team about milestones due or overdue |
| Should | Registered-resale playbook (sub-registrar route) alongside the builder-assignment one |
| Should | Party update email ("where your deal stands") through `notify()`, curator-triggered |
| Could | Link a `Deal` from a closed `Enquiry` in one click |
| Won't | Party login or portal (contradicts the no-visitor-accounts decision; revisit after slice 1) |
| Won't | Broker features (brand conflict) |
| Won't | Bank or builder integrations (no APIs; email works) |
| Won't | Model-written clauses (legal risk; templates must be advocate-vetted) |
| Won't | E-stamp / e-sign (later, through a provider) |
| Won't | Storing Aadhaar numbers or KYC images (see section 7) |

## 4. Data model (proposal; follow `prisma/schema.prisma` conventions)

Everything below follows the existing rules:
- every `DateTime` is `@db.Timestamptz(3)`
- money is paise, `BigInt` for amounts that can exceed ₹2.15 Cr
- cuid ids
- a `reference` handle like `NIV-XXXXXX`, here `CLS-XXXXXX`
- single-tenant, no `orgId`

```prisma
enum DealPlaybook {
  BUILDER_ASSIGNMENT // assign a builder Agreement to Sell (e.g. Sobha); builder approval + transfer fee
  REGISTERED_RESALE  // registered sale deed at the sub-registrar
}

enum DealStatus { DRAFT ACTIVE AT_RISK CLOSED CANCELLED }

enum DealPartyRole { SELLER BUYER SELLER_BANK BUYER_BANK BUILDER ASSOCIATION OTHER }

enum MilestoneStatus { PENDING IN_PROGRESS DONE BLOCKED SKIPPED }

enum DealDocumentKind { MOU LOU BANK_NOC_LOD_REQUEST BANK_FORECLOSURE_REQUEST BANK_FOLLOW_UP }

enum DealPaymentKind { TOKEN BOOKING SELF_FUNDING LOAN_DISBURSAL SELLER_LOAN_PAYOFF TDS BALANCE OTHER }

model Deal {
  id         String       @id @default(cuid())
  reference  String       @unique // "CLS-7Q4KX2"
  playbook   DealPlaybook
  status     DealStatus   @default(DRAFT)

  propertyId   String?    // null for a deal Nivasa did not list
  property     Property?  @relation(fields: [propertyId], references: [id], onDelete: SetNull)
  enquiryId    String?    @unique
  enquiry      Enquiry?   @relation(fields: [enquiryId], references: [id], onDelete: SetNull)
  propertyLabel String    // snapshot, e.g. "Sobha Dream Gardens A-1042" — same reasoning as Enquiry.propertyName

  considerationPaise BigInt
  /// The facts every document renders from. Validated by a zod schema in lib/validations.ts.
  /// JSON rather than columns because each playbook needs different fields; the schema, not
  /// the column list, is the contract.
  sheet      Json

  mouSignedAt  DateTime? @db.Timestamptz(3)
  deadlineAt   DateTime? @db.Timestamptz(3) // computed from mouSignedAt + sheet.deadlineDays
  closedAt     DateTime? @db.Timestamptz(3)

  handledBy  String?
  handler    Admin?     @relation("DealHandler", fields: [handledBy], references: [id], onDelete: SetNull)

  createdAt  DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt  DateTime   @updatedAt @db.Timestamptz(3)

  parties    DealParty[]
  milestones DealMilestone[]
  documents  DealDocument[]
  payments   DealPayment[]

  @@index([status, deadlineAt])
}

model DealParty {
  id      String        @id @default(cuid())
  dealId  String
  deal    Deal          @relation(fields: [dealId], references: [id], onDelete: Cascade)
  role    DealPartyRole
  name    String
  email   String?
  phone   String?       // E.164 via lib/validations.ts
  /// Seller's share of the property, in basis points (5000 = 50%). Drives the TDS split.
  shareBps Int?
  panLast4 String?      // never the full PAN; see section 7
  @@index([dealId, role])
}

model DealMilestone {
  id        String          @id @default(cuid())
  dealId    String
  deal      Deal            @relation(fields: [dealId], references: [id], onDelete: Cascade)
  key       String          // stable key from the playbook, e.g. "seller_bank_lod"
  label     String
  ownerRole DealPartyRole
  status    MilestoneStatus @default(PENDING)
  dueAt     DateTime?       @db.Timestamptz(3)
  doneAt    DateTime?       @db.Timestamptz(3)
  notes     String?
  sortOrder Int
  @@unique([dealId, key])
  @@index([status, dueAt])
}

model DealDocument {
  id        String           @id @default(cuid())
  dealId    String
  deal      Deal             @relation(fields: [dealId], references: [id], onDelete: Cascade)
  kind      DealDocumentKind
  version   Int
  /// Rendered HTML of this version, as generated. Kept so a later sheet edit cannot rewrite
  /// what was already sent or signed.
  html      String
  /// Hash of the sheet it was rendered from, to show "sheet changed since this version".
  sheetHash String
  createdBy String?
  createdAt DateTime         @default(now()) @db.Timestamptz(3)
  @@unique([dealId, kind, version])
}

model DealPayment {
  id          String          @id @default(cuid())
  dealId      String
  deal        Deal            @relation(fields: [dealId], references: [id], onDelete: Cascade)
  kind        DealPaymentKind
  amountPaise BigInt
  fromLabel   String
  toLabel     String          // e.g. "Seller 1", "Seller bank (loan payoff)"
  paidAt      DateTime?       @db.Timestamptz(3) // null = planned, not yet paid
  txnRef      String?
  createdAt   DateTime        @default(now()) @db.Timestamptz(3)
  @@index([dealId, kind])
}
```

Add `deals Deal[]` to `Property`, `deal Deal?` to `Enquiry`, and `handledDeals Deal[] @relation("DealHandler")` to `Admin`. Add `NotificationType` values `DEAL_MILESTONE_DUE`, `DEAL_AT_RISK` and `DEAL_PARTY_UPDATE`.

## 5. Where the code goes (follow the route-handler rule)

| File | Responsibility |
|---|---|
| `lib/deal-playbooks.ts` | The two playbooks as data: ordered milestones with key, label, owner role, due offset (from MOU signing or the deadline) |
| `lib/deal-sheet.ts` | The zod `DealSheet` schema (in `lib/validations.ts` if that's the house rule) and derived values (deadline, TDS per seller, net to sellers) |
| `lib/deal-consistency.ts` | `checkDealConsistency(sheet, payments) → Issue[]`: pure, no I/O, imported directly by tests |
| `lib/deal-documents.ts` | Deterministic HTML templates per `DealDocumentKind`; printable like `lib/brochure.ts` |
| `lib/deal-extract.ts` | Model call that turns pasted chat text into a *proposed* partial sheet plus a list of uncertain fields |
| `lib/deals.ts` | Create a deal from a playbook, update milestones and payments, render a document version, compute status |
| `app/api/admin/deals/…` | parse → `requireRole("CURATOR")` → delegate to `lib/` → `apiOk` |
| `app/api/cron/deal-milestones/route.ts` | Same posture as `viewing-reminders`: `Bearer $CRON_SECRET`, 503 without it, a stamp to prevent double sends |
| `app/dashboard/deals/` | List (sorted by deadline, at-risk first) and detail (milestones, sheet, documents, ledger) |
| `e2e/tests/deals.spec.ts` | CRUD and playbook expansion; `deal-consistency.spec.ts` for the pure checker |

**The model composes; it never decides.** This is the same rule as `lib/reply-agent.ts`. Extraction only proposes field values, and a curator confirms them. Clauses come from templates, never from the model. Whether a document may be marked final is decided by `checkDealConsistency()` in ordinary code.

## 6. Rules the checker must enforce (seeded from the A-1042 drafts)

Each has a test case built from the sanitised fixture in section 10.

1. **Execution date** is on or after every payment date the document acknowledges as already received.
2. **Deadline** = execution date + `deadlineDays` (60 in the fixture). Any rendered "on or before" date must match.
3. **Notices clause** relies on email, so every party in the notices clause has an email on the sheet.
4. **Possession and handover** are present in the binding body. Utility and maintenance accounts move to the buyer at handover.
5. **Amounts reconcile.** Named components add up to their stated totals (token + booking = "booking amount" wherever it's used), and booking + self-funding + loan + TDS = consideration.
6. **TDS** = 1% of consideration when consideration is ₹50 L or more (Sec 194-IA), split across sellers by `shareBps`.
7. **Terminology** is consistent: one term per instrument across all clauses (e.g. "Assignment Agreement").
8. **No blanks.** No unfilled placeholder dates or amounts in a document marked final. Transaction IDs may stay blank until signing day only if flagged.
9. **Association name** matches the project on the sheet in every document.
10. **No cross-document contradiction on liabilities.** The LOU and MOU must not assign the same pre-transfer dues to different parties.
11. **Bank delay.** Warn, don't block, if a penalty applies to a party for delays caused by a bank or builder without an automatic extension clause.

## 7. Privacy (stricter than the rest of the app, on purpose)

- **Never persist Aadhaar numbers or KYC images.** Store `panLast4` only.
- **Full PAN goes into the document only at render time.** If a document needs full PANs (the MOU does), the curator enters them in the render request, and they go into that `DealDocument.html` only.
  - Decide in the plan whether rendered HTML with full PANs may be stored at all, or rendered on demand and never stored. Recommend: not stored; store the version with PANs masked.
- **Loan account numbers:** last 4 only on the sheet.
- **Pasted WhatsApp text is never stored.** It's used for extraction in the request and then dropped.
- **DTOs pick fields one by one** (`lib/dto.ts` rule). Nothing deal-related reaches the public site.

## 8. Before you start building

- **Check the Clerk session issue in `CLAUDE.md` first.** The signed-in specs are gated off because the server didn't accept the session they created, and it "may mean the dashboard is unreachable for a real curator." Close is dashboard-only, so confirm a real curator can sign in to `/dashboard` on production before building on it.
- **Live-site launch blockers, worth fixing in the same sprint:**
  - placeholder RERA number
  - testimonials labelled as samples
  - placeholder photography

## 9. Open decisions (answer in the plan, or flag for Girish)

1. **Legal review.** Templates need a Bangalore property advocate's review before any document is sent to a real party. Until then, every rendered document carries a "draft for review" banner.
2. **RERA registration before charging.** Taking a fee for facilitating a sale may require real-estate-agent registration under Karnataka RERA. Slice 1 charges nothing; check with a lawyer before pricing.
3. **Full-PAN storage** (section 7).
4. **Party-facing view.** Email-only for slice 1. A tokenised read-only link is the likely slice 2, and needs a decision against the no-visitor-accounts rule.
5. **Inbound email.** Should messages with `ReplyIntent.DOCUMENTS` attach to a deal when the sender matches a `DealParty.email`? Recommend: yes, read-only, slice 2.

## 10. Test fixture (sanitised from the real deal; no real identifiers)

```json
{
  "playbook": "BUILDER_ASSIGNMENT",
  "propertyLabel": "Sobha Dream Gardens, Wing 1, A-1042",
  "builder": "Sobha Limited",
  "builderAgreementDate": "2023-11-21",
  "associationName": "Sobha Dream Gardens owners association",
  "superBuiltUpSqft": 1009.97,
  "considerationPaise": 1160000000,
  "deadlineDays": 60,
  "extensionDays": 15,
  "sellers": [
    { "name": "Seller One", "shareBps": 5000, "email": "seller1@example.com" },
    { "name": "Seller Two", "shareBps": 5000, "email": "seller2@example.com" }
  ],
  "buyer": { "name": "Buyer One", "email": "buyer@example.com" },
  "sellerBank": { "name": "SBI", "branch": "RACPC", "loanLast4": "0000" },
  "payments": [
    { "kind": "TOKEN", "amountPaise": 10000000, "to": "Seller One", "paidAt": "2026-10-13" },
    { "kind": "BOOKING", "amountPaise": 15000000, "to": "Seller One", "paidAt": null },
    { "kind": "BOOKING", "amountPaise": 25000000, "to": "Seller Two", "paidAt": null },
    { "kind": "SELF_FUNDING", "amountPaise": 110000000, "to": "Sellers", "paidAt": null }
  ],
  "stampDutyPayer": "BUYER",
  "transferFeePayer": "SELLER",
  "penaltyPaise": 30000000,
  "lateSelfFundingPenaltyPerDayPaise": 500000
}
```

Expected derived values:
- booking total ₹16 L
- TDS ₹1,16,000, i.e. ₹58,000 per seller
- net to sellers after TDS ₹1,14,84,000
- with MOU signed 16 Oct 2026, the deadline is 15 Dec 2026

Checker cases (each should produce exactly one issue):
- execution date set to 11 Oct while the token is dated 13 Oct (rule 1)
- deadline rendered as 10 Dec (rule 2)
- one seller's email removed (rule 3)
- the booking amount stated as ₹4 L in one place and ₹5 L in another (rule 5)
- the association name changed to another project's (rule 9)

## 11. Done means

- [ ] Migration applied with `db:migrate`; nothing uses `db push`
- [ ] A curator can create a deal from a playbook, fill the sheet (with extraction assist), record payments, and tick milestones
- [ ] MOU, LOU and the three bank emails render from the fixture; a final MOU is refused while the checker reports errors
- [ ] Ledger shows reconciled vs. outstanding against consideration, TDS per seller, net to sellers
- [ ] Cron emails the team about due or overdue milestones, once per milestone per day, through `notify()`
- [ ] `npm run lint`, `npm run typecheck` and `npm run test:e2e` pass; checker specs import the pure function directly
- [ ] `CLAUDE.md` gains a "Deals (Nivasa Close)" section in the same style as the rest

Success metric for the feature, not the code: the A-1042 deal is run through Close to completion by its 15 Dec deadline, then 3 paid closes by 31 Dec once pricing is cleared.
