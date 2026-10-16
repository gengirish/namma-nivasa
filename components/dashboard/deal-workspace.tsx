"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DealExtractPanel } from "@/components/dashboard/deal-extract-panel";
import { DealLedger, fromProposal, type PaymentDraft } from "@/components/dashboard/deal-ledger";
import { DealSheetEditor } from "@/components/dashboard/deal-sheet-editor";
import { fromDraft, toDraft, type SheetDraft } from "@/components/dashboard/deal-sheet-draft";
import { callApi, primaryButton, ErrorText } from "@/components/dashboard/deal-shared";
import type { DealDetailDto } from "@/lib/deal-types";

/**
 * The sheet editor, the extraction assist and the ledger, sharing one piece of state.
 *
 * The extraction assist writes into the editor's form state and the ledger's add form — never
 * to the server. Save is the curator's, and it is the only path by which a proposal persists.
 * After a save the page re-reads the deal (`router.refresh()`) so the ledger summary and the
 * consistency issues reflect the sheet just written.
 */
export function DealWorkspace({ deal }: { deal: DealDetailDto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<SheetDraft>(() =>
    toDraft(deal.sheet ?? deal.rawSheet, {
      playbook: deal.playbook,
      propertyLabel: deal.propertyLabel,
      considerationPaise: deal.considerationPaise,
    }),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [prefill, setPrefill] = useState<PaymentDraft | null>(null);
  const [prefillKey, setPrefillKey] = useState(0);

  const update = (next: SheetDraft) => {
    setDraft(next);
    setDirty(true);
    setSaved(false);
  };

  async function save() {
    const built = fromDraft(draft);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setSaving(true);
    setError(null);
    const res = await callApi<DealDetailDto>(`/api/admin/deals/${deal.id}`, "PATCH", { sheet: built.sheet });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDirty(false);
    setSaved(true);
    startTransition(() => router.refresh());
  }

  const busy = saving || pending;
  const locked = deal.status === "CLOSED" || deal.status === "CANCELLED";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 440px), 1fr))",
        gap: 20,
        alignItems: "start",
      }}
    >
      <div>
        <h2 style={{ fontSize: "1.1rem", margin: "0 0 12px", color: "#1C1917" }}>Deal sheet</h2>
        {deal.sheet === null && (
          <p style={{ fontSize: "0.82rem", color: "#92400E", margin: "0 0 12px" }}>
            The stored sheet does not validate yet — documents and the ledger summary wait until it
            does. Fill in what is missing and save.
          </p>
        )}
        <DealSheetEditor value={draft} onChange={update} />
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            position: "sticky",
            bottom: 0,
            background: "#FAF7F2",
            padding: "12px 0",
          }}
        >
          <button type="button" style={primaryButton(busy || locked)} disabled={busy || locked} onClick={() => void save()}>
            {saving ? "Saving…" : "Save sheet"}
          </button>
          {dirty && !error && <span style={{ fontSize: "0.8rem", color: "#92400E" }}>Unsaved changes</span>}
          {saved && !dirty && !error && <span style={{ fontSize: "0.8rem", color: "#3F6212" }}>Saved.</span>}
          {locked && <span style={{ fontSize: "0.8rem", color: "#78716C" }}>This deal is {deal.status.toLowerCase()}.</span>}
          {error && <ErrorText>{error}</ErrorText>}
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: "1.1rem", margin: "0 0 12px", color: "#1C1917" }}>Assist and money</h2>
        {!locked && (
          <DealExtractPanel
            dealId={deal.id}
            draft={draft}
            onApply={update}
            onProposePayment={(p) => {
              setPrefill(fromProposal(p));
              setPrefillKey((k) => k + 1);
            }}
          />
        )}
        <DealLedger
          deal={deal}
          prefill={prefill}
          prefillKey={prefillKey}
          onClearPrefill={() => setPrefill(null)}
        />
      </div>
    </div>
  );
}
