# NIVASA_AGENT_AUTOSEND — the autonomy decision

Opened 11/08/2026, for the product discussion on whether the reply agent may email a customer
without a curator reading the message first. The mechanics are settled and implemented; what is
open is a set of judgement calls that engineering should not make alone.

Presentable version of this document, for sharing outside the repo:
<https://claude.ai/code/artifact/2c02a4e5-c2bf-4ccb-8eb9-652af14e83ea>

Behaviour described here is as implemented in `lib/reply-agent.ts`, `lib/email-threads.ts` and
`app/api/webhooks/agentmail/route.ts`. If any of those change, change this file in the same commit
— a stale decision brief is worse than none, because it is quoted in rooms where nobody can read
the code.

## State

| | |
|---|---|
| Value in `.env.example` and local env | empty — off |
| Production value | held in Vercel, **not readable from the repo**. Confirm before quoting a current state. |
| Effect while off | every drafted reply waits for a curator at `/dashboard/inbox` |
| Cost of changing it | an environment change and a redeploy; no code change, and the same two minutes to reverse |

## The switch is not "turn the agent on"

The agent already runs with the flag off. An inbound reply is Svix-verified, stored, threaded onto
the enquiry it belongs to, and answered by a draft composed from a facts block built out of our own
rows — all of that happens today. The draft carries the model's own one-sentence note on what it
answered and what it deliberately did not.

`NIVASA_AGENT_AUTOSEND` decides one thing: whether that draft leaves the building on its own, or
waits for a person to click send. Turning it off degrades nothing; it is the mode the system was
built to run in first. What the flag buys is the seconds between *drafted* and *sent*, on three
kinds of question.

## The chain

`autoSendRefusal()` (`lib/reply-agent.ts:296`) returns the reason a draft must wait, or `null` if
it may go alone. Five conditions, evaluated in order, short-circuiting at the first failure:

| # | Test | Where it lives | Refusal string |
|---|---|---|---|
| 1 | `NIVASA_AGENT_AUTOSEND === "1"` | env, per environment | `Autonomous sending is off` |
| 2 | intent on a three-entry whitelist | `AUTO_SEND_INTENTS`, `reply-agent.ts:39` | `PRICE_NEGOTIATION always goes to review` |
| 3 | confidence ≥ 80 | `CONFIDENCE_FLOOR`, `reply-agent.ts:41` | `Confidence 62 is below the floor of 80` |
| 4 | `answeredFromFacts` is true | model-reported, code-enforced | `The reply does not answer entirely from what we hold` |
| 5 | thread under 3 auto-replies | `AUTO_SEND_BUDGET_PER_THREAD`, `email-threads.ts:53` | `This thread has already had 3 automatic replies` |

Gate 1 is the only one changed by configuration. Gates 2–5 are constants in code and need a
release. The flag is therefore a master switch wired *in front of* four narrower ones — arming it
does not open the inbox.

**The strictness of gate 1 is deliberate.** `autoSendEnabled()` matches `"1"` exactly, so an unset
value, an empty string, `true`, `yes`, or a typo all read as off. The failure mode of a
config flag guarding outbound mail must be "nothing sends".

**The model composes; it never decides.** Gates 3 and 4 read numbers the model reported about
itself, but nothing lets the model act on them — `autoSendRefusal()` is ordinary code. A model
classifying its own message as safe to send is not a safety control.

**Every refusal is recorded.** The reason is appended to the draft's rationale and shown beside it
in the dashboard, so review mode is quietly producing the evidence we would need to justify
turning the flag on.

## Scope — what may be answered alone

The test used to build the whitelist: *can this be answered completely from a published listing and
a booking we already hold, such that being wrong is embarrassing rather than expensive?*

| Intent | Typical message | With the flag on | Why |
|---|---|---|---|
| `PROPERTY_QUESTION` | "Is there a covered parking bay?" | **sends alone** | answerable from the listing we published |
| `LOGISTICS` | "What's the address? Where do I park?" | **sends alone** | facts we already hold; wrong is embarrassing, not costly |
| `VIEWING_CONFIRM` | "Saturday 11am, yes?" | **sends alone** | reads back a booking on the books; changes nothing |
| `VIEWING_RESCHEDULE` | "Could we move it to Sunday?" | waits | the owner has already been told about the original slot |
| `VIEWING_CANCEL` | "Sorry, we need to cancel." | waits | same; the agent is told it has not booked, moved or cancelled anything |
| `PRICE_NEGOTIATION` | "Would they take 2.6 crore?" | waits | a sentence here is worth lakhs and commits somebody not in the conversation |
| `DOCUMENTS` | "Send the khata and the sale deed?" | waits | claiming we hold a document we do not is the worst failure available |
| `OTHER` | outside the taxonomy | waits | unclassified means unbounded |
| `UNCLEAR` | "Yes — and the other thing?" | waits | the agent admitting it does not follow is the signal to hand over |

Six of nine wait. Waiting is not a failure state.

## What the flag being on changes about our exposure

Three things, and they are the substance of the decision rather than its mechanics.

**A wrong answer is delivered rather than merely composed.** Off, a bad draft costs a curator ten
seconds of reading. On, it costs a correction email to someone who has already read the first one.
The gates make that unlikely; they cannot make it impossible.

**The public webhook becomes a path to a customer's inbox.** `POST /api/webhooks/agentmail` is
public by necessity — there is no session on the other end of an email. It is verified against the
raw body and returns 503 when no signing secret is configured, with no branch that processes an
unverified payload, *because* with autonomous sending armed a forged delivery would reach a real
person. Off, the worst case is a spurious draft in the dashboard. On, the worst case is in
somebody's inbox. This is also why `e2e/support/env.ts` pins `NIVASA_AGENT_AUTOSEND: ""` for the
server under test, alongside blanked AgentMail and Anthropic credentials: `inbound-email.spec.ts`
drives the real handler, so a send must be *impossible* rather than unlikely.

**A recipient cannot tell a machine wrote it.** The system prompt signs off as "Nivasa", with no
individual's name and no marker that the reply was composed automatically. That is a deliberate
voice choice and it reads well, but with autonomous sending it stops being a copy question and
becomes a disclosure question.

## Operations

- The inbox header already announces the mode — "Every drafted reply waits for a curator" or
  "Autonomous sending is ON for a narrow set of intents" (`app/dashboard/inbox/page.tsx:65`).
  Nobody has to remember which state we are in.
- `AgentDraft.status` records `AUTO_SENT` separately from a curator-approved send, so "did a person
  read this before it went?" stays answerable per message, a year later.
- A failed send degrades to review: the thread flips to `AWAITING_REVIEW` rather than dropping the
  reply silently (`reply-agent.ts:368`).
- Rollback is clearing the variable and redeploying. Drafts queue again from the next inbound
  message. Nothing already sent can be recalled.
- With `ANTHROPIC_API_KEY` unset the flag does nothing — messages are recorded and nothing is
  drafted at all. With the AgentMail credentials unset, no mail is received in the first place.

## Open — the product calls

Each is a value someone chose, all cheap to change, none load-bearing on the architecture.

- [ ] **Disclosure.** Do automated replies have to say they are automated? They do not today.
      Adding a line is trivial; deciding whether the voice can carry it is not.
- [ ] **Scope.** Are those three intents the right three? `VIEWING_CONFIRM` is the one worth
      arguing about — highest volume, and the closest to a commitment.
- [ ] **Threshold.** Is a confidence floor of 80 defensible, or just round? It was chosen before
      there were any drafts to calibrate against.
- [ ] **Budget.** Three automatic replies per thread — too many? The number bounds a
      machine-to-machine loop; a stricter one is a stronger guarantee and a worse experience.
- [ ] **Evidence.** What has to be true before we turn it on? Suggested bar: a stated number of
      drafts reviewed in the whitelisted intents with no material correction. **Nothing counts that
      today** — the data is in `AgentDraft`, but no dashboard reports it. Worth building before the
      decision, not after.
- [ ] **Expectation.** Does answering a parking question in four seconds set a tempo the six
      intents that still wait cannot match?
- [ ] **Rollback.** Who may turn it off, and on what trigger? Two minutes of work, but only if
      somebody is watching and knows they can act without a meeting.

## Recommendation

Leave it off, and set the bar that turns it on. The expensive work — grounding replies in our own
rows, the intent taxonomy, the loop budget, the audit trail — is built and running. Review mode
costs us latency on three kinds of question and nothing else, and the one thing it is missing is a
count of how often the agent would have been right.

For the discussion: agree the disclosure line, agree a number of clean drafts in the whitelisted
intents, and surface that count in the dashboard. Then flipping the flag is an observation rather
than a bet.
