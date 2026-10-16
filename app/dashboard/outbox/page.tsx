import { Empty, PageHeading, Pill, card, formatIst, td, th } from "@/components/dashboard/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Every message the app decided to send, and what became of it.
 *
 * Delivery goes through AgentMail. Without credentials the rows land SKIPPED with the reason
 * recorded and this page is the honest substitute — the team reads what would have gone out and
 * follows up by hand. With credentials the same rows read SENT. Nothing on this page changed
 * when the provider was wired, which is the point of routing every message through `notify()`.
 *
 * This is the outbound *audit*, not the conversation. Replies from visitors live at
 * /dashboard/inbox.
 */
export default async function OutboxPage() {
  await requireRole("VIEWER");

  const [logs, skipped] = await Promise.all([
    prisma.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.notificationLog.count({ where: { status: "SKIPPED" } }),
  ]);

  return (
    <>
      <PageHeading
        title="Outbox"
        sub={
          skipped > 0
            ? `${skipped} message${skipped === 1 ? "" : "s"} not sent — AgentMail is not configured. Read them here and follow up by hand.`
            : "Every message the app decided to send."
        }
      />

      <div style={{ ...card, overflowX: "auto" }}>
        {logs.length === 0 ? (
          <Empty>Nothing yet. Messages are queued when an enquiry or submission arrives.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>To</th>
                <th style={th}>Message</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "#78716C" }}>
                    {formatIst(log.createdAt, true)}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div>{log.recipient}</div>
                    {log.cc.length > 0 && (
                      <div style={{ fontSize: "0.72rem", color: "#78716C", marginTop: 4 }}>
                        cc {log.cc.join(", ")}
                      </div>
                    )}
                  </td>
                  <td style={td}>
                    <div style={{ color: "#1C1917" }}>{log.subject}</div>
                    <pre
                      style={{
                        margin: "8px 0 0",
                        fontSize: "0.78rem",
                        color: "#57534E",
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                        maxWidth: 480,
                      }}
                    >
                      {log.body}
                    </pre>
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <Pill value={log.status} />
                      {log.error && (
                        <span style={{ fontSize: "0.72rem", color: "#78716C" }}>{log.error}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
