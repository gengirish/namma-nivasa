"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { button, callApi, dangerButton, ErrorText } from "@/components/dashboard/deal-shared";
import type { DealDetailDto } from "@/lib/deal-types";

/**
 * The deal header's actions: close, cancel, and the party update. Each asks first — closing and
 * cancelling end the deal room's countdown, and a party update is an email to real people.
 */
export function DealActions({ deal }: { deal: DealDetailDto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const finished = deal.status === "CLOSED" || deal.status === "CANCELLED";
  const working = busy || pending;

  async function setStatus(status: "CLOSED" | "CANCELLED") {
    const question =
      status === "CLOSED"
        ? `Mark ${deal.reference} closed? Do this once the transfer is done and the money has moved.`
        : `Cancel ${deal.reference}? The deal and its history are kept, but it leaves the active list.`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setError(null);
    const res = await callApi<DealDetailDto>(`/api/admin/deals/${deal.id}`, "PATCH", { status });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    startTransition(() => router.refresh());
  }

  async function partyUpdate() {
    if (!window.confirm("Email every party with an address on the sheet a summary of where the deal stands?")) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // The spec said `{ sent }`; lib/deals.ts returns `{ notified, recipients }`. Read either.
    const res = await callApi<{ sent?: number; notified?: number }>(
      `/api/admin/deals/${deal.id}/party-update`,
      "POST",
      {},
    );
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const sent = res.data.notified ?? res.data.sent ?? 0;
    setNotice(
      sent === 0
        ? "Nobody was emailed — no party has an address, or mail is not configured (see the outbox)."
        : `Sent to ${sent} part${sent === 1 ? "y" : "ies"}. Delivery is in the outbox.`,
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={button} disabled={working || finished} onClick={() => void partyUpdate()}>
          Send party update
        </button>
        <button type="button" style={button} disabled={working || finished} onClick={() => void setStatus("CLOSED")}>
          Close deal
        </button>
        <button type="button" style={dangerButton} disabled={working || finished} onClick={() => void setStatus("CANCELLED")}>
          Cancel deal
        </button>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {notice && <span style={{ fontSize: "0.8rem", color: "#3F6212" }}>{notice}</span>}
    </div>
  );
}
