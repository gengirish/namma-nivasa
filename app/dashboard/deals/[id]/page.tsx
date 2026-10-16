import Link from "next/link";
import { notFound } from "next/navigation";

import { DealActions } from "@/components/dashboard/deal-actions";
import { DealDocuments } from "@/components/dashboard/deal-documents";
import { DealMilestones } from "@/components/dashboard/deal-milestones";
import { Countdown, DealPill, Section } from "@/components/dashboard/deal-shared";
import { DealWorkspace } from "@/components/dashboard/deal-workspace";
import { SERIF, formatIst } from "@/components/dashboard/ui";
import { DomainError, requireRole } from "@/lib/auth";
import { PLAYBOOKS } from "@/lib/deal-playbooks";
import { formatRupees, istDateOf } from "@/lib/deal-sheet";
import { getDeal } from "@/lib/deals";

/**
 * One deal room: header and countdown, consistency issues, milestones, the sheet with its
 * extraction assist and ledger, and the documents.
 *
 * Reads `getDeal()`'s DTO rather than raw rows — unlike the listing editor, nothing here needs
 * a field the DTO leaves out, and a deal's sheet must be parsed by one function, not two.
 */
export const dynamic = "force-dynamic";

/** Today in IST, for "overdue". Computed per request so a long-open tab re-reads it on refresh. */
function todayIst(): string {
  return istDateOf(new Date());
}

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("CURATOR");
  const { id } = await params;

  const deal = await getDeal(id).catch((err: unknown) => {
    if (err instanceof DomainError && err.status === 404) notFound();
    throw err;
  });

  const finished = deal.status === "CLOSED" || deal.status === "CANCELLED";
  const errors = deal.issues.filter((i) => i.severity === "error");
  const warnings = deal.issues.filter((i) => i.severity === "warning");

  return (
    <>
      <p style={{ margin: "0 0 12px" }}>
        <Link href="/dashboard/deals" style={{ color: "#A16207", fontSize: "0.85rem" }}>
          ← All deals
        </Link>
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.8rem", margin: 0, color: "#1C1917" }}>
            {deal.propertyLabel}
          </h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8, fontSize: "0.9rem", color: "#78716C" }}>
            <span style={{ fontFamily: "ui-monospace, monospace", color: "#1C1917" }}>{deal.reference}</span>
            <DealPill value={deal.status} />
            <span>{PLAYBOOKS[deal.playbook]?.label ?? deal.playbook}</span>
            <span>{formatRupees(deal.considerationPaise)}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: "0.9rem", color: "#57534E" }}>
            {deal.deadlineAt ? <>Deadline {formatIst(deal.deadlineAt)} · </> : null}
            {finished ? (
              deal.closedAt ? `closed ${formatIst(deal.closedAt)}` : deal.status.toLowerCase()
            ) : (
              <Countdown daysLeft={deal.daysLeft} />
            )}
            {deal.mouSignedAt && <> · MOU signed {formatIst(deal.mouSignedAt)}</>}
            {deal.enquiryId && (
              <>
                {" · "}
                <Link href="/dashboard/enquiries" style={{ color: "#A16207" }}>
                  from an enquiry
                </Link>
              </>
            )}
          </div>
        </div>
        <DealActions deal={deal} />
      </div>

      <Section
        title="Consistency"
        aside={
          <span style={{ fontSize: "0.8rem", color: errors.length ? "#991B1B" : "#166534" }}>
            {errors.length
              ? `${errors.length} error${errors.length === 1 ? "" : "s"} — a final MOU is refused until they are fixed`
              : "No errors"}
          </span>
        }
      >
        {deal.issues.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "#78716C", margin: 0 }}>
            {deal.sheet ? "The sheet and ledger agree with every rule." : "Checks run once the sheet validates."}
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {[...errors, ...warnings].map((issue, n) => {
              const error = issue.severity === "error";
              return (
                <li
                  key={`${issue.code}-${n}`}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "8px 10px",
                    marginBottom: 6,
                    fontSize: "0.85rem",
                    background: error ? "#FEF2F2" : "#FFFBEB",
                    borderLeft: `3px solid ${error ? "#DC2626" : "#D97706"}`,
                    color: error ? "#991B1B" : "#92400E",
                  }}
                >
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>Rule {issue.rule}</span>
                  <span>
                    {issue.message}
                    {issue.where && <span style={{ color: "#78716C" }}> — {issue.where}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <DealMilestones deal={deal} todayIst={todayIst()} />

      <DealWorkspace key={deal.id} deal={deal} />

      <div style={{ marginTop: 20 }}>
        <DealDocuments deal={deal} />
      </div>
    </>
  );
}
