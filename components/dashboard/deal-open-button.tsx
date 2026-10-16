"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { callApi } from "@/components/dashboard/deal-shared";
import { PLAYBOOKS } from "@/lib/deal-playbooks";
import type { DealDetailDto } from "@/lib/deal-types";

/**
 * "Open deal" on a CLOSED enquiry: one click into Nivasa Close, with the enquiry's home as the
 * property and the visitor as the buyer. An enquiry has at most one deal (`Deal.enquiryId
 * @unique`), so once it exists this is a link to it rather than a second button.
 */
export function DealOpenButton({ enquiryId, dealId }: { enquiryId: string; dealId: string | null }) {
  const router = useRouter();
  const [playbook, setPlaybook] = useState<keyof typeof PLAYBOOKS>("BUILDER_ASSIGNMENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dealId) {
    return (
      <Link href={`/dashboard/deals/${dealId}`} style={{ fontSize: "0.78rem", color: "#A16207" }}>
        Open deal →
      </Link>
    );
  }

  async function open() {
    setBusy(true);
    setError(null);
    const res = await callApi<DealDetailDto>("/api/admin/deals", "POST", { enquiryId, playbook });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push(`/dashboard/deals/${res.data.id}`);
  }

  const small = {
    padding: "4px 8px",
    border: "1px solid #DDD5C9",
    borderRadius: 2,
    background: "#FAF7F2",
    color: "#1C1917",
    fontFamily: "inherit",
    fontSize: "0.74rem",
  } as const;

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "inline-flex", gap: 4 }}>
        <select
          aria-label="Playbook"
          value={playbook}
          disabled={busy}
          onChange={(e) => setPlaybook(e.target.value as keyof typeof PLAYBOOKS)}
          style={small}
        >
          {Object.values(PLAYBOOKS).map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="button" disabled={busy} onClick={() => void open()} style={{ ...small, cursor: "pointer", color: "#A16207" }}>
          {busy ? "Opening…" : "Open deal"}
        </button>
      </span>
      {error && <span style={{ fontSize: "0.7rem", color: "#991B1B" }}>{error}</span>}
    </span>
  );
}
