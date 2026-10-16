"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Field, button, callApi, input, primaryButton, rupeesToPaise, ErrorText } from "@/components/dashboard/deal-shared";
import { PLAYBOOKS } from "@/lib/deal-playbooks";
import type { DealDetailDto } from "@/lib/deal-types";

/**
 * Opens a deal from a playbook. Three facts are enough to start — the rest of the sheet is
 * filled in on the deal page, by hand or with the extraction assist.
 */
export function DealCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [playbook, setPlaybook] = useState<keyof typeof PLAYBOOKS>("BUILDER_ASSIGNMENT");
  const [propertyLabel, setPropertyLabel] = useState("");
  const [rupees, setRupees] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" style={primaryButton(false)} onClick={() => setOpen(true)}>
        New deal
      </button>
    );
  }

  async function create() {
    const considerationPaise = rupeesToPaise(rupees);
    if (considerationPaise === null || considerationPaise <= 0) {
      setError("Enter the consideration in rupees, e.g. 11600000 or 1,16,00,000");
      return;
    }
    if (propertyLabel.trim().length < 3) {
      setError("Name the property, e.g. “Sobha Dream Gardens, Wing 1, A-1042”");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await callApi<DealDetailDto>("/api/admin/deals", "POST", {
      playbook,
      propertyLabel: propertyLabel.trim(),
      considerationPaise,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/dashboard/deals/${res.data.id}`);
  }

  return (
    <div
      style={{
        border: "1px solid #E7E0D6",
        borderRadius: 3,
        padding: 20,
        background: "#FFFDF9",
        maxWidth: 620,
      }}
    >
      <Field text="Playbook" hint={PLAYBOOKS[playbook].summary}>
        <select
          style={input}
          value={playbook}
          onChange={(e) => setPlaybook(e.target.value as keyof typeof PLAYBOOKS)}
        >
          {Object.values(PLAYBOOKS).map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field text="Property" hint="As the documents will name it. Snapshotted, so it survives the listing being archived.">
        <input style={input} value={propertyLabel} onChange={(e) => setPropertyLabel(e.target.value)} />
      </Field>
      <Field text="Sale consideration (₹)" hint="Rupees; stored as paise.">
        <input style={input} inputMode="decimal" value={rupees} onChange={(e) => setRupees(e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button type="button" style={primaryButton(busy)} disabled={busy} onClick={() => void create()}>
          {busy ? "Creating…" : "Create deal"}
        </button>
        <button type="button" style={button} disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    </div>
  );
}
