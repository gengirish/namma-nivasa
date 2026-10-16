import Link from "next/link";

import { DealCreateForm } from "@/components/dashboard/deal-create-form";
import { Countdown, DealPill } from "@/components/dashboard/deal-shared";
import { Empty, PageHeading, card, formatIst, td, th } from "@/components/dashboard/ui";
import { requireRole } from "@/lib/auth";
import { PLAYBOOKS } from "@/lib/deal-playbooks";
import { formatRupees } from "@/lib/deal-sheet";
import type { DealListItemDto } from "@/lib/deal-types";
import { listDeals } from "@/lib/deals";

/**
 * Nivasa Close — every deal in the room. At-risk first, then the nearest deadline: the order a
 * curator should work them in. Closed and cancelled deals sink to the bottom.
 */
export const dynamic = "force-dynamic";

const DONE = new Set(["CLOSED", "CANCELLED"]);

function byUrgency(a: DealListItemDto, b: DealListItemDto): number {
  const rank = (d: DealListItemDto) => (d.status === "AT_RISK" ? 0 : DONE.has(d.status) ? 2 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.deadlineAt && b.deadlineAt) return a.deadlineAt.localeCompare(b.deadlineAt);
  if (a.deadlineAt) return -1;
  if (b.deadlineAt) return 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export default async function DealsPage() {
  // Close is curator-operated end to end; a VIEWER has nothing to do here.
  await requireRole("CURATOR");
  const deals = [...(await listDeals())].sort(byUrgency);

  return (
    <>
      <PageHeading
        title="Deals"
        sub="Direct owner–buyer sales after the viewing. At-risk first, then by deadline."
      />

      <div style={{ marginBottom: 24 }}>
        <DealCreateForm />
      </div>

      <div style={{ ...card, overflowX: "auto" }}>
        {deals.length === 0 ? (
          <Empty>No deals yet. Open one here, or from a closed enquiry.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>Reference</th>
                <th style={th}>Property</th>
                <th style={th}>Playbook</th>
                <th style={th}>Status</th>
                <th style={th}>Consideration</th>
                <th style={th}>Deadline</th>
                <th style={th}>Milestones</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id}>
                  <td style={{ ...td, whiteSpace: "nowrap", fontFamily: "ui-monospace, monospace" }}>
                    <Link href={`/dashboard/deals/${d.id}`} style={{ color: "#A16207" }}>
                      {d.reference}
                    </Link>
                  </td>
                  <td style={td}>{d.propertyLabel}</td>
                  <td style={{ ...td, color: "#57534E" }}>{PLAYBOOKS[d.playbook]?.label ?? d.playbook}</td>
                  <td style={td}>
                    <DealPill value={d.status} />
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{formatRupees(d.considerationPaise)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {d.deadlineAt ? <div>{formatIst(d.deadlineAt)}</div> : null}
                    <div style={{ fontSize: "0.82rem" }}>
                      {DONE.has(d.status) ? (
                        <span style={{ color: "#A8A29E" }}>—</span>
                      ) : (
                        <Countdown daysLeft={d.daysLeft} />
                      )}
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <div>{d.openMilestones} open</div>
                    {d.overdueMilestones > 0 && (
                      <div style={{ fontSize: "0.82rem", color: "#991B1B", fontWeight: 600 }}>
                        {d.overdueMilestones} overdue
                      </div>
                    )}
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
