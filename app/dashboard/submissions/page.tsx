import Link from "next/link";

import { CreateListingButton } from "@/components/dashboard/create-listing-button";
import { StatusControl } from "@/components/dashboard/status-control";
import { Empty, PageHeading, Pill, card, formatIst, td, th } from "@/components/dashboard/ui";
import { hasRole, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const STATUSES = ["NEW", "REVIEWING", "ACCEPTED", "DECLINED"] as const;

export default async function SubmissionsPage() {
  const session = await requireRole("VIEWER");
  const canEdit = hasRole(session.role, "CURATOR");

  const submissions = await prisma.ownerSubmission.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <PageHeading
        title="Owner intake"
        sub="Homes offered to us. Files are described, not uploaded — ask the owner to send them."
      />

      <div style={{ ...card, overflowX: "auto" }}>
        {submissions.length === 0 ? (
          <Empty>Nothing submitted yet.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>Received</th>
                <th style={th}>Owner</th>
                <th style={th}>Home</th>
                <th style={th}>Asking</th>
                <th style={th}>Reference</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((sub) => (
                <tr key={sub.id}>
                  <td style={{ ...td, whiteSpace: "nowrap", color: "#78716C" }}>
                    {formatIst(sub.createdAt, true)}
                  </td>
                  <td style={td}>
                    <div>{sub.name}</div>
                    <div style={{ fontSize: "0.82rem", color: "#78716C" }}>{sub.phone}</div>
                    {sub.email && (
                      <div style={{ fontSize: "0.82rem", color: "#78716C" }}>{sub.email}</div>
                    )}
                  </td>
                  <td style={td}>
                    <div>{sub.locality}</div>
                    <div style={{ fontSize: "0.82rem", color: "#78716C" }}>
                      {[sub.propertyType, sub.config, sub.areaSqft ? `${sub.areaSqft} sqft` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#A8A29E", marginTop: 4 }}>
                      {sub.mediaCount > 0
                        ? `${sub.mediaCount} file(s) on hand`
                        : "No media offered"}
                      {sub.timeline ? ` · ${sub.timeline}` : ""}
                    </div>
                    {sub.message && (
                      <div style={{ fontSize: "0.82rem", color: "#57534E", marginTop: 6, maxWidth: 320 }}>
                        “{sub.message}”
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{sub.expectedPrice ?? "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>
                    {sub.reference}
                  </td>
                  <td style={td}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <Pill value={sub.status} />
                      <StatusControl
                        endpoint={`/api/admin/submissions/${sub.id}`}
                        current={sub.status}
                        options={STATUSES}
                        disabled={!canEdit}
                      />
                      {sub.propertyId ? (
                        <Link
                          href={`/dashboard/properties/${sub.propertyId}`}
                          style={{ color: "#A16207", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                        >
                          View listing →
                        </Link>
                      ) : (
                        sub.status === "ACCEPTED" &&
                        canEdit && <CreateListingButton submissionId={sub.id} />
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
