"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DealPill, Section, callApi, input, ErrorText } from "@/components/dashboard/deal-shared";
import { PLAYBOOKS } from "@/lib/deal-playbooks";
import { formatShortDate, istDateOf } from "@/lib/deal-sheet";
import type { DealDetailDto, DealMilestoneDto } from "@/lib/deal-types";

/**
 * The deal's milestones, grouped the way the playbook anchors them: what runs from the MOU's
 * signing, and what runs back from the deadline. Each change PATCHes one milestone and
 * re-reads the deal — the server stamps `doneAt` and recomputes AT_RISK, not this component.
 */

const STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "BLOCKED", "SKIPPED"] as const;
const FINISHED = new Set(["DONE", "SKIPPED"]);

function MilestoneRow({
  dealId,
  m,
  todayIst,
  disabled,
}: {
  dealId: string;
  m: DealMilestoneDto;
  todayIst: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(m.notes ?? "");

  const due = m.dueAt ? istDateOf(new Date(m.dueAt)) : "";
  const overdue = Boolean(due) && due < todayIst && !FINISHED.has(m.status);
  const busy = saving || pending || disabled;

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    const res = await callApi<DealDetailDto>(`/api/admin/deals/${dealId}/milestones/${m.id}`, "PATCH", body);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <tr style={{ background: overdue ? "#FEF2F2" : undefined }}>
      <td style={{ padding: "10px 12px 10px 0", borderTop: "1px solid #ECE5DB", verticalAlign: "top", fontSize: "0.88rem" }}>
        <div style={{ color: FINISHED.has(m.status) ? "#78716C" : "#1C1917", textDecoration: m.status === "SKIPPED" ? "line-through" : undefined }}>
          {m.label}
        </div>
        <div style={{ fontSize: "0.72rem", color: "#A8A29E" }}>{m.ownerRole.replace(/_/g, " ").toLowerCase()}</div>
        {m.doneAt && (
          <div style={{ fontSize: "0.72rem", color: "#166534" }}>done {formatShortDate(istDateOf(new Date(m.doneAt)))}</div>
        )}
        {error && <ErrorText>{error}</ErrorText>}
      </td>
      <td style={{ padding: "10px 12px 10px 0", borderTop: "1px solid #ECE5DB", verticalAlign: "top", whiteSpace: "nowrap" }}>
        <select
          aria-label={`Status of ${m.label}`}
          value={m.status}
          disabled={busy}
          onChange={(e) => void patch({ status: e.target.value })}
          style={{ ...input, width: "auto", padding: "6px 8px", fontSize: "0.8rem" }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 4 }}>
          <DealPill value={m.status} />
        </div>
      </td>
      <td style={{ padding: "10px 12px 10px 0", borderTop: "1px solid #ECE5DB", verticalAlign: "top", whiteSpace: "nowrap" }}>
        <input
          type="date"
          aria-label={`Due date of ${m.label}`}
          defaultValue={due}
          key={due}
          disabled={busy}
          onBlur={(e) => {
            if (e.target.value !== due) void patch({ dueAt: e.target.value || null });
          }}
          style={{ ...input, width: "auto", padding: "6px 8px", fontSize: "0.8rem", borderColor: overdue ? "#FCA5A5" : "#DDD5C9" }}
        />
        {overdue && <div style={{ fontSize: "0.72rem", color: "#991B1B", fontWeight: 600, marginTop: 2 }}>overdue</div>}
        {!due && <div style={{ fontSize: "0.72rem", color: "#A8A29E", marginTop: 2 }}>waits for MOU date</div>}
      </td>
      <td style={{ padding: "10px 0", borderTop: "1px solid #ECE5DB", verticalAlign: "top", minWidth: 200 }}>
        <input
          aria-label={`Notes on ${m.label}`}
          placeholder="Notes"
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (m.notes ?? "")) void patch({ notes: notes.trim() || null });
          }}
          style={{ ...input, padding: "6px 8px", fontSize: "0.8rem" }}
        />
      </td>
    </tr>
  );
}

export function DealMilestones({ deal, todayIst }: { deal: DealDetailDto; todayIst: string }) {
  const playbook = PLAYBOOKS[deal.playbook];
  const anchorOf = new Map(playbook?.milestones.map((m) => [m.key, m.anchor]) ?? []);
  const sorted = [...deal.milestones].sort((a, b) => a.sortOrder - b.sortOrder);
  const groups = [
    { title: "From the MOU", rows: sorted.filter((m) => anchorOf.get(m.key) === "MOU") },
    { title: "Toward the deadline", rows: sorted.filter((m) => anchorOf.get(m.key) === "DEADLINE") },
    { title: "Other", rows: sorted.filter((m) => !anchorOf.has(m.key)) },
  ].filter((g) => g.rows.length > 0);

  const done = deal.milestones.filter((m) => FINISHED.has(m.status)).length;
  const locked = deal.status === "CLOSED" || deal.status === "CANCELLED";

  return (
    <Section
      title="Milestones"
      aside={
        <span style={{ fontSize: "0.8rem", color: "#78716C" }}>
          {done} of {deal.milestones.length} done
        </span>
      }
    >
      {deal.milestones.length === 0 ? (
        <p style={{ fontSize: "0.85rem", color: "#A8A29E" }}>No milestones on this deal.</p>
      ) : (
        groups.map((g) => (
          <div key={g.title} style={{ marginBottom: 18, overflowX: "auto" }}>
            <h3 style={{ fontSize: "0.85rem", margin: "0 0 6px", color: "#57534E", fontWeight: 600 }}>{g.title}</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <tbody>
                {g.rows.map((m) => (
                  <MilestoneRow key={m.id} dealId={deal.id} m={m} todayIst={todayIst} disabled={locked} />
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </Section>
  );
}
