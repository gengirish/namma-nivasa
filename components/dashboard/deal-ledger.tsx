"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";

import {
  PAYMENT_KINDS,
  Section,
  button,
  callApi,
  dangerButton,
  input,
  paiseToRupees,
  primaryButton,
  rupeesToPaise,
  ErrorText,
} from "@/components/dashboard/deal-shared";
import { formatIst, td, th } from "@/components/dashboard/ui";
import { formatRupees, istDateOf, type LedgerPayment } from "@/lib/deal-sheet";
import type { DealDetailDto, DealPaymentDto, LedgerSummaryDto } from "@/lib/deal-types";

/**
 * The money ledger: every payment, made or planned, against the sale consideration.
 *
 * A payment with no `paidAt` is *planned*. The plan reconciles when paid + planned equals the
 * consideration — the unplanned gap is zero — and that is the one number a curator needs to see
 * go green before signing day. Derived figures (TDS per seller, net to sellers, booking amount)
 * come from the server's `deriveSheet()`, never recomputed here.
 */

interface PaymentDraft {
  kind: string;
  rupees: string;
  fromLabel: string;
  toLabel: string;
  paidAt: string;
  txnRef: string;
}

const blank: PaymentDraft = { kind: "TOKEN", rupees: "", fromLabel: "", toLabel: "", paidAt: "", txnRef: "" };

function fromDto(p: DealPaymentDto): PaymentDraft {
  return {
    kind: p.kind,
    rupees: paiseToRupees(p.amountPaise),
    fromLabel: p.fromLabel,
    toLabel: p.toLabel,
    paidAt: p.paidAt ? istDateOf(new Date(p.paidAt)) : "",
    txnRef: p.txnRef ?? "",
  };
}

export function fromProposal(p: LedgerPayment): PaymentDraft {
  return {
    kind: p.kind,
    rupees: paiseToRupees(p.amountPaise),
    fromLabel: p.fromLabel ?? "",
    toLabel: p.toLabel,
    paidAt: p.paidAt ?? "",
    txnRef: p.txnRef ?? "",
  };
}

function toBody(d: PaymentDraft): { body: Record<string, unknown> } | { error: string } {
  const amountPaise = rupeesToPaise(d.rupees);
  if (amountPaise === null || amountPaise <= 0) return { error: "Enter the amount in rupees" };
  if (!d.fromLabel.trim() || !d.toLabel.trim()) return { error: "Say who paid and who received it" };
  return {
    body: {
      kind: d.kind,
      amountPaise,
      fromLabel: d.fromLabel.trim(),
      toLabel: d.toLabel.trim(),
      paidAt: d.paidAt || null,
      txnRef: d.txnRef.trim() || null,
    },
  };
}

const cellInput: CSSProperties = { ...input, padding: "6px 8px", fontSize: "0.8rem" };

function PaymentForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: PaymentDraft;
  submitLabel: string;
  busy: boolean;
  onSubmit: (d: PaymentDraft) => void;
  onCancel?: () => void;
}) {
  const [d, setD] = useState(initial);
  const set = (k: keyof PaymentDraft, v: string) => setD((p) => ({ ...p, [k]: v }));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, alignItems: "end" }}>
      <select style={cellInput} value={d.kind} onChange={(e) => set("kind", e.target.value)} aria-label="Kind">
        {PAYMENT_KINDS.map((k) => (
          <option key={k} value={k}>
            {k.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      <input style={cellInput} placeholder="Amount (₹)" inputMode="decimal" value={d.rupees} onChange={(e) => set("rupees", e.target.value)} aria-label="Amount in rupees" />
      <input style={cellInput} placeholder="From" value={d.fromLabel} onChange={(e) => set("fromLabel", e.target.value)} aria-label="From" />
      <input style={cellInput} placeholder="To" value={d.toLabel} onChange={(e) => set("toLabel", e.target.value)} aria-label="To" />
      <input style={cellInput} type="date" value={d.paidAt} onChange={(e) => set("paidAt", e.target.value)} aria-label="Paid on (blank = planned)" title="Blank = planned, not yet paid" />
      <input style={cellInput} placeholder="Txn ref" value={d.txnRef} onChange={(e) => set("txnRef", e.target.value)} aria-label="Transaction reference" />
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" style={{ ...primaryButton(busy), padding: "6px 12px" }} disabled={busy} onClick={() => onSubmit(d)}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" style={{ ...button, padding: "6px 10px" }} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function SummaryLine({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", fontSize: "0.85rem" }}>
      <span style={{ color: "#78716C" }}>{label}</span>
      <span style={{ fontWeight: strong ? 600 : 400, color: tone ?? "#1C1917", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function Summary({ ledger }: { ledger: LedgerSummaryDto }) {
  const reconciled = ledger.unplannedPaise === 0;
  return (
    <div style={{ border: "1px solid #ECE5DB", borderRadius: 3, padding: 14, background: "#fff", marginBottom: 16 }}>
      <div
        style={{
          fontSize: "0.78rem",
          fontWeight: 600,
          marginBottom: 8,
          color: reconciled ? "#166534" : "#92400E",
        }}
      >
        {reconciled
          ? "✓ Reconciled — paid and planned payments add up to the consideration"
          : ledger.unplannedPaise > 0
            ? `Not reconciled — ${formatRupees(ledger.unplannedPaise)} of the consideration has no payment planned`
            : `Not reconciled — payments exceed the consideration by ${formatRupees(-ledger.unplannedPaise)}`}
      </div>
      <SummaryLine label="Consideration" value={formatRupees(ledger.considerationPaise)} strong />
      <SummaryLine label="Paid" value={formatRupees(ledger.paidPaise)} />
      <SummaryLine label="Planned" value={formatRupees(ledger.plannedPaise)} />
      <SummaryLine
        label="Unplanned gap"
        value={formatRupees(ledger.unplannedPaise)}
        tone={reconciled ? "#166534" : "#991B1B"}
      />
      <SummaryLine label="Outstanding" value={formatRupees(ledger.outstandingPaise)} strong />
      <div style={{ borderTop: "1px solid #ECE5DB", margin: "8px 0" }} />
      <SummaryLine label="Booking amount (token + booking)" value={formatRupees(ledger.derived.bookingAmountPaise)} />
      <SummaryLine label="TDS (Sec 194-IA)" value={formatRupees(ledger.derived.tdsPaise)} />
      {ledger.derived.tdsBySeller.map((s) => (
        <SummaryLine
          key={s.name}
          label={`   ${s.name} (${s.shareBps / 100}%)`}
          value={formatRupees(s.tdsPaise)}
        />
      ))}
      <SummaryLine label="Net to sellers after TDS" value={formatRupees(ledger.derived.netToSellersPaise)} strong />
    </div>
  );
}

export function DealLedger({
  deal,
  prefill,
  prefillKey,
  onClearPrefill,
}: {
  deal: DealDetailDto;
  /** A payment the extraction assist proposed, loaded into the add form for review. */
  prefill: PaymentDraft | null;
  prefillKey: number;
  onClearPrefill: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const showAdd = adding || prefill !== null;
  const closeAdd = () => {
    setAdding(false);
    onClearPrefill();
  };

  async function send(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await callApi<DealDetailDto>(url, method, body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    startTransition(() => router.refresh());
    return true;
  }

  const base = `/api/admin/deals/${deal.id}/payments`;
  const working = busy || pending;

  return (
    <Section
      title="Ledger"
      aside={
        !showAdd && (
          <button type="button" style={button} onClick={() => setAdding(true)}>
            Add a payment
          </button>
        )
      }
    >
      {deal.ledger ? (
        <Summary ledger={deal.ledger} />
      ) : (
        <p style={{ fontSize: "0.82rem", color: "#92400E" }}>
          The sheet does not validate yet, so the ledger cannot be reconciled. Fix the sheet first.
        </p>
      )}

      {showAdd && (
        <div style={{ marginBottom: 16, padding: 12, background: "#FAF7F2", border: "1px dashed #DDD5C9" }}>
          {prefill && (
            <p style={{ fontSize: "0.75rem", color: "#92400E", margin: "0 0 8px" }}>
              Proposed by the extraction assist — check every field before adding.
            </p>
          )}
          <PaymentForm
            key={prefillKey}
            initial={prefill ?? blank}
            submitLabel="Add"
            busy={working}
            onSubmit={async (d) => {
              const b = toBody(d);
              if ("error" in b) return setError(b.error);
              if (await send(base, "POST", b.body)) closeAdd();
            }}
            onCancel={closeAdd}
          />
        </div>
      )}

      {error && (
        <p style={{ margin: "0 0 12px" }}>
          <ErrorText>{error}</ErrorText>
        </p>
      )}

      {deal.payments.length === 0 ? (
        <p style={{ fontSize: "0.85rem", color: "#A8A29E" }}>No payments recorded yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={th}>Kind</th>
                <th style={th}>Amount</th>
                <th style={th}>From → to</th>
                <th style={th}>Status</th>
                <th style={th}>Txn ref</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {deal.payments.map((p) =>
                editing === p.id ? (
                  <tr key={p.id}>
                    <td style={td} colSpan={6}>
                      <PaymentForm
                        initial={fromDto(p)}
                        submitLabel="Save"
                        busy={working}
                        onSubmit={async (d) => {
                          const b = toBody(d);
                          if ("error" in b) return setError(b.error);
                          if (await send(`${base}/${p.id}`, "PATCH", b.body)) setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={p.id}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{p.kind.replace(/_/g, " ")}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatRupees(p.amountPaise)}</td>
                    <td style={td}>
                      {p.fromLabel} → {p.toLabel}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {p.paidAt ? (
                        <span style={{ color: "#166534" }}>paid {formatIst(p.paidAt)}</span>
                      ) : (
                        <span style={{ color: "#92400E" }}>planned</span>
                      )}
                    </td>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: "0.8rem" }}>
                      {p.txnRef ?? <span style={{ color: "#A8A29E" }}>—</span>}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                      <button type="button" style={{ ...button, padding: "4px 10px" }} disabled={working} onClick={() => setEditing(p.id)}>
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        style={{ ...dangerButton, padding: "4px 10px" }}
                        disabled={working}
                        onClick={() => {
                          if (window.confirm(`Delete this ${p.kind.toLowerCase()} payment of ${formatRupees(p.amountPaise)}?`)) {
                            void send(`${base}/${p.id}`, "DELETE");
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export type { PaymentDraft };
