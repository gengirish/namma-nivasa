import { DealOpenButton } from "@/components/dashboard/deal-open-button";
import { StatusControl } from "@/components/dashboard/status-control";
import { Empty, PageHeading, Pill, card, formatIst, td, th } from "@/components/dashboard/ui";
import { hasRole, requireRole } from "@/lib/auth";
import { enquiryHeadline } from "@/lib/enquiries";
import { prisma } from "@/lib/prisma";
import { slotLabel } from "@/lib/slots";

export const dynamic = "force-dynamic";

const STATUSES = ["NEW", "CONTACTED", "SCHEDULED", "CLOSED", "CANCELLED"] as const;

export default async function EnquiriesPage() {
  const session = await requireRole("VIEWER");
  const canEdit = hasRole(session.role, "CURATOR");

  const enquiries = await prisma.enquiry.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      viewing: { select: { scheduledFor: true, status: true } },
      deal: { select: { id: true } },
    },
  });

  return (
    <>
      <PageHeading
        title="Enquiries"
        sub={
          canEdit
            ? "Newest first. Moving one to CANCELLED cancels its viewing too."
            : "Newest first. Your role is read-only."
        }
      />

      <div style={{ ...card, overflowX: "auto" }}>
        {enquiries.length === 0 ? (
          <Empty>No enquiries yet. They arrive here the moment someone submits the form.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>Received</th>
                <th style={th}>Who</th>
                <th style={th}>About</th>
                <th style={th}>When</th>
                <th style={th}>Reference</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "#78716C" }}>
                    {formatIst(e.createdAt, true)}
                  </td>
                  <td style={td}>
                    <div style={{ color: "#1C1917" }}>{e.name}</div>
                    <div style={{ fontSize: "0.82rem", color: "#78716C" }}>{e.phone}</div>
                    {e.email && (
                      <div style={{ fontSize: "0.82rem", color: "#78716C" }}>{e.email}</div>
                    )}
                  </td>
                  <td style={td}>
                    <div>{e.propertyName ?? "General enquiry"}</div>
                    <div style={{ fontSize: "0.82rem", color: "#78716C" }}>
                      {enquiryHeadline(e.kind)}
                    </div>
                    {e.message && (
                      <div
                        style={{
                          fontSize: "0.82rem",
                          color: "#57534E",
                          marginTop: 6,
                          maxWidth: 320,
                        }}
                      >
                        “{e.message}”
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {e.viewing ? (
                      <>
                        <div>{formatIst(e.viewing.scheduledFor)}</div>
                        <div style={{ fontSize: "0.82rem", color: "#A16207" }}>
                          {slotLabel(e.viewing.scheduledFor)}
                        </div>
                        {e.viewing.status === "CANCELLED" && (
                          <div style={{ fontSize: "0.72rem", color: "#991B1B" }}>cancelled</div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: "#A8A29E" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>
                    {e.reference}
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <Pill value={e.status} />
                      <StatusControl
                        endpoint={`/api/admin/enquiries/${e.id}`}
                        current={e.status}
                        options={STATUSES}
                        disabled={!canEdit}
                      />
                      {canEdit && e.status === "CLOSED" && (
                        <DealOpenButton enquiryId={e.id} dealId={e.deal?.id ?? null} />
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
