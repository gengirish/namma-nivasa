"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Create listing" on an accepted intake row. The server decides whether this makes a draft or
 * finds the one already made — either way the answer is a listing id, and we go there.
 */
export function CreateListingButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/submissions/${submissionId}/listing`, { method: "POST" });
      const payload = (await res.json().catch(() => null)) as
        | { success: false; error: string }
        | { success: true; data: { id: string } }
        | null;
      if (!res.ok || !payload?.success) {
        setError(payload && !payload.success ? payload.error : "Could not create the listing");
        setBusy(false);
        return;
      }
      router.push(`/dashboard/properties/${payload.data.id}`);
    } catch {
      setError("Could not reach the server");
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy}
        style={{
          padding: "6px 10px",
          background: "#A16207",
          color: "#fff",
          border: "1px solid #A16207",
          borderRadius: 2,
          fontFamily: "inherit",
          fontSize: "0.78rem",
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? "Creating…" : "Create listing"}
      </button>
      {error && <span style={{ fontSize: "0.7rem", color: "#991B1B" }}>{error}</span>}
    </span>
  );
}
