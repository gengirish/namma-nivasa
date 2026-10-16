"use client";

import { useState } from "react";

import { Section, button, callApi, input, primaryButton, ErrorText } from "@/components/dashboard/deal-shared";
import {
  displayLeaf,
  draftLocation,
  flattenProposal,
  getAt,
  sameValue,
  setAt,
  toFormValue,
  type LeafKind,
  type SheetDraft,
} from "@/components/dashboard/deal-sheet-draft";
import { formatRupees, formatShortDate, type LedgerPayment } from "@/lib/deal-sheet";
import type { ExtractionProposal, UncertainField } from "@/lib/deal-types";

/**
 * Extraction assist. The model proposes; this panel shows the proposal as a diff against the
 * editor and lets a curator tick what is right. "Apply selected" writes into the editor's form
 * state only — nothing is saved until the curator presses Save on the sheet.
 *
 * The pasted text leaves this component in exactly one request and the textarea is cleared as
 * soon as that request is sent, whatever its outcome: the text is never stored, so it should
 * not linger on screen either.
 */

interface Row {
  path: string;
  segs: string[];
  kind: LeafKind;
  formValue: string | boolean;
  uncertain: string | null;
}

function uncertaintyFor(path: string, uncertain: UncertainField[]): string | null {
  const hit = uncertain.find(
    (u) => u.field === path || path.startsWith(`${u.field}.`) || u.field.startsWith(`${path}.`),
  );
  return hit ? hit.reason : null;
}

export function DealExtractPanel({
  dealId,
  draft,
  onApply,
  onProposePayment,
}: {
  dealId: string;
  draft: SheetDraft;
  onApply: (next: SheetDraft) => void;
  onProposePayment: (p: LedgerPayment) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [payments, setPayments] = useState<LedgerPayment[]>([]);
  const [dropped, setDropped] = useState<UncertainField[]>([]);
  const [notes, setNotes] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState<string | null>(null);

  async function propose() {
    const body = { text };
    setText(""); // never kept on screen past the request
    setBusy(true);
    setError(null);
    setApplied(null);
    const res = await callApi<ExtractionProposal>(`/api/admin/deals/${dealId}/extract`, "POST", body);
    setBusy(false);
    if (!res.ok) {
      setError(res.status === 503 ? "The extraction model is not configured on this server." : res.error);
      return;
    }

    const next: Row[] = flattenProposal(res.data.proposed).map((leaf) => {
      const { segs, kind } = draftLocation(leaf.path);
      return {
        path: leaf.path,
        segs,
        kind,
        formValue: toFormValue(kind, leaf.value),
        uncertain: uncertaintyFor(leaf.path, res.data.uncertain),
      };
    });
    setRows(next);
    // Uncertain fields arrive unticked; a curator has to opt in to each one.
    setChecked(Object.fromEntries(next.map((r) => [r.path, !r.uncertain])));
    setPayments(res.data.payments);
    setDropped(res.data.uncertain.filter((u) => !next.some((r) => uncertaintyFor(r.path, [u]))));
    setNotes(res.data.notes);
  }

  function apply() {
    if (!rows) return;
    let next = draft;
    let n = 0;
    for (const r of rows) {
      if (!checked[r.path]) continue;
      next = setAt(next, r.segs, r.formValue);
      n++;
    }
    onApply(next);
    setApplied(`${n} field${n === 1 ? "" : "s"} applied to the form — review, then Save the sheet.`);
  }

  const changed = rows?.filter((r) => !sameValue(r.kind, getAt(draft, r.segs), r.formValue)) ?? [];
  const unchanged = (rows?.length ?? 0) - changed.length;

  return (
    <Section title="Extraction assist">
      <p style={{ fontSize: "0.8rem", color: "#78716C", margin: "0 0 12px" }}>
        The model proposes fields; you choose which to apply. The pasted text is sent once and
        never stored.
      </p>
      <textarea
        style={{ ...input, minHeight: 140 }}
        placeholder="Paste WhatsApp export or notes"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "10px 0 0" }}>
        <button
          type="button"
          style={primaryButton(busy || !text.trim())}
          disabled={busy || !text.trim()}
          onClick={() => void propose()}
        >
          {busy ? "Reading…" : "Propose fields"}
        </button>
        {error && <ErrorText>{error}</ErrorText>}
      </div>

      {rows && (
        <div style={{ marginTop: 18 }}>
          {notes && <p style={{ fontSize: "0.85rem", color: "#57534E", margin: "0 0 12px" }}>{notes}</p>}

          {changed.length === 0 ? (
            <p style={{ fontSize: "0.82rem", color: "#78716C" }}>
              Nothing new — every proposed field already matches the form.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#A8A29E" }}>
                  <th style={{ padding: "0 6px 6px 0" }} />
                  <th style={{ padding: "0 6px 6px 0", fontWeight: 600 }}>Field</th>
                  <th style={{ padding: "0 6px 6px 0", fontWeight: 600 }}>Now</th>
                  <th style={{ padding: "0 6px 6px 0", fontWeight: 600 }}>Proposed</th>
                </tr>
              </thead>
              <tbody>
                {changed.map((r) => (
                  <tr key={r.path} style={{ borderTop: "1px solid #ECE5DB", background: r.uncertain ? "#FFFBEB" : undefined }}>
                    <td style={{ padding: "6px 6px 6px 0", verticalAlign: "top" }}>
                      <input
                        type="checkbox"
                        aria-label={`Apply ${r.path}`}
                        checked={Boolean(checked[r.path])}
                        onChange={(e) => setChecked((c) => ({ ...c, [r.path]: e.target.checked }))}
                      />
                    </td>
                    <td style={{ padding: "6px 6px 6px 0", fontFamily: "ui-monospace, monospace", verticalAlign: "top" }}>
                      {r.path}
                      {r.uncertain && (
                        <div style={{ fontFamily: "inherit", color: "#92400E", fontSize: "0.72rem" }}>
                          uncertain: {r.uncertain}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "6px 6px 6px 0", color: "#78716C", verticalAlign: "top" }}>
                      {displayLeaf(r.kind, getAt(draft, r.segs))}
                    </td>
                    <td style={{ padding: "6px 6px 6px 0", verticalAlign: "top" }}>{displayLeaf(r.kind, r.formValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {unchanged > 0 && (
            <p style={{ fontSize: "0.72rem", color: "#A8A29E", margin: "6px 0 0" }}>
              {unchanged} proposed field{unchanged === 1 ? "" : "s"} already match the form.
            </p>
          )}

          {dropped.length > 0 && (
            <div style={{ marginTop: 12, fontSize: "0.78rem", color: "#92400E" }}>
              <strong>Not proposed:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {dropped.map((u, i) => (
                  <li key={i}>
                    <code>{u.field}</code> — {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {changed.length > 0 && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
              <button type="button" style={button} onClick={apply}>
                Apply selected
              </button>
              {applied && <span style={{ fontSize: "0.8rem", color: "#3F6212" }}>{applied}</span>}
            </div>
          )}

          {payments.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <span style={{ fontSize: "0.7rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#78716C" }}>
                Payments mentioned
              </span>
              <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
                {payments.map((p, i) => (
                  <li
                    key={i}
                    style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderTop: "1px solid #ECE5DB", fontSize: "0.82rem" }}
                  >
                    <span>
                      {p.kind.replace(/_/g, " ")} · {formatRupees(p.amountPaise)} → {p.toLabel}
                      <span style={{ color: "#78716C" }}> · {p.paidAt ? `paid ${formatShortDate(p.paidAt)}` : "planned"}</span>
                    </span>
                    <button type="button" style={{ ...button, padding: "4px 10px" }} onClick={() => onProposePayment(p)}>
                      Review in ledger
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
