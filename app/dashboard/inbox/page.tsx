import Link from "next/link";

import { DraftReview } from "@/components/dashboard/draft-review";
import { Empty, PageHeading, Pill, SERIF, card, formatIst } from "@/components/dashboard/ui";
import { agentMailConfigured } from "@/lib/agentmail";
import { hasRole, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { autoSendEnabled, replyAgentConfigured } from "@/lib/reply-agent";

/**
 * Conversations with visitors, and the replies the agent has proposed.
 *
 * The counterpart to /dashboard/outbox: that page is the outbound audit — what the app decided
 * to send — and this one is the two-way conversation. A thread appears here the moment a reply
 * lands, whether or not the agent managed to draft anything, because "someone wrote to us and
 * nothing happened" is the state most worth being able to see.
 */
export const dynamic = "force-dynamic";

const OPEN_FIRST = ["AWAITING_REVIEW", "OPEN", "CLOSED"] as const;

export default async function InboxPage() {
  const session = await requireRole("VIEWER");
  const canAct = hasRole(session.role, "CURATOR");

  const threads = await prisma.emailThread.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    include: {
      enquiry: {
        select: { reference: true, name: true, status: true, propertyName: true },
      },
      messages: { orderBy: { receivedAt: "desc" }, take: 6 },
      drafts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // Threads waiting on a person float to the top; within each group the newest conversation
  // first. Sorted here rather than in SQL because the ordering is a product judgement about
  // what a curator opening this page should deal with first, not a property of the data.
  const ordered = [...threads].sort((a, b) => {
    const rank = OPEN_FIRST.indexOf(a.status) - OPEN_FIRST.indexOf(b.status);
    return rank !== 0 ? rank : b.lastMessageAt.getTime() - a.lastMessageAt.getTime();
  });

  const waiting = threads.filter((t) => t.status === "AWAITING_REVIEW").length;

  return (
    <>
      <PageHeading
        title="Inbox"
        sub={
          !agentMailConfigured()
            ? "AgentMail is not configured, so no mail is being received. Set AGENTMAIL_API_KEY and AGENTMAIL_INBOX_ID."
            : waiting > 0
              ? `${waiting} thread${waiting === 1 ? "" : "s"} waiting on you.`
              : "Replies from enquirers, and what the agent proposed to say back."
        }
      />

      {agentMailConfigured() && (
        <p style={{ fontSize: "0.8rem", color: "#78716C", margin: "-14px 0 24px" }}>
          {!replyAgentConfigured()
            ? "No reply agent is configured — messages are recorded but nothing is drafted."
            : autoSendEnabled()
              ? "Autonomous sending is ON for a narrow set of intents. Everything else waits here."
              : "Every drafted reply waits for a curator. Nothing is sent automatically."}
        </p>
      )}

      {ordered.length === 0 ? (
        <div style={card}>
          <Empty>Nothing yet. Threads appear here when someone replies to one of our emails.</Empty>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {ordered.map((thread) => {
            const draft = thread.drafts[0];
            const pending = draft && (draft.status === "PENDING_REVIEW" || draft.status === "FAILED");
            const conversation = [...thread.messages].reverse();

            return (
              <div key={thread.id} style={card}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                    alignItems: "baseline",
                  }}
                >
                  <div>
                    <h2
                      style={{
                        fontFamily: SERIF,
                        fontSize: "1.05rem",
                        margin: 0,
                        color: "#1C1917",
                        fontWeight: 600,
                      }}
                    >
                      {thread.subject || "(no subject)"}
                    </h2>
                    <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "#78716C" }}>
                      {thread.participantEmail}
                      {thread.enquiry ? (
                        <>
                          {" · "}
                          <Link href="/dashboard/enquiries" className="nv-footlink" style={{ color: "#57534E" }}>
                            {thread.enquiry.reference}
                          </Link>
                          {thread.enquiry.propertyName ? ` · ${thread.enquiry.propertyName}` : ""}
                        </>
                      ) : (
                        " · not matched to any enquiry"
                      )}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: "0.75rem", color: "#A8A29E", whiteSpace: "nowrap" }}>
                      {formatIst(thread.lastMessageAt, true)}
                    </span>
                    <Pill value={thread.status} />
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "18px 0 0" }}>
                  {conversation.map((message) => (
                    <div
                      key={message.id}
                      style={{
                        borderLeft: `2px solid ${message.direction === "INBOUND" ? "#C99A3F" : "#DDD5C9"}`,
                        paddingLeft: 12,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: "0.68rem",
                          letterSpacing: "0.1em",
                          textTransform: "uppercase",
                          color: "#A8A29E",
                          fontWeight: 600,
                        }}
                      >
                        {message.direction === "INBOUND" ? "They wrote" : "We sent"} ·{" "}
                        {formatIst(message.receivedAt, true)}
                      </p>
                      <pre
                        style={{
                          margin: "6px 0 0",
                          fontSize: "0.84rem",
                          color: "#44403C",
                          whiteSpace: "pre-wrap",
                          fontFamily: "inherit",
                          lineHeight: 1.55,
                        }}
                      >
                        {message.text.slice(0, 1500)}
                      </pre>
                    </div>
                  ))}
                </div>

                {draft && (
                  <div
                    style={{
                      marginTop: 20,
                      paddingTop: 18,
                      borderTop: "1px solid #ECE5DB",
                    }}
                  >
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Pill value={draft.status} />
                      <Pill value={draft.intent} />
                      <span style={{ fontSize: "0.75rem", color: "#78716C" }}>
                        {draft.confidence}% confident
                      </span>
                      {draft.error && (
                        <span style={{ fontSize: "0.75rem", color: "#991B1B" }}>{draft.error}</span>
                      )}
                    </div>
                    <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: "#78716C", fontStyle: "italic" }}>
                      {draft.rationale}
                    </p>

                    {pending ? (
                      <DraftReview
                        draftId={draft.id}
                        initialSubject={draft.subject}
                        initialBody={draft.body}
                        disabled={!canAct}
                      />
                    ) : (
                      <pre
                        style={{
                          margin: "12px 0 0",
                          fontSize: "0.84rem",
                          color: "#57534E",
                          whiteSpace: "pre-wrap",
                          fontFamily: "inherit",
                          lineHeight: 1.55,
                        }}
                      >
                        {draft.body}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
