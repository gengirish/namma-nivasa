"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * The one write control the dashboard tables use.
 *
 * It PATCHes and then `router.refresh()`es rather than mutating a local copy: the server is
 * where status lives, and re-reading it is what keeps two curators working the same inbox from
 * seeing different answers. `disabled` reflects the caller's role — a VIEWER gets the same
 * table, read-only, rather than a control that fails on click.
 */
export function StatusControl({
  endpoint,
  current,
  options,
  disabled,
}: {
  endpoint: string;
  current: string;
  options: readonly string[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = async (next: string) => {
    if (next === current) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { success: false; error: string }
        | { success: true }
        | null;
      if (!res.ok || !payload?.success) {
        setError(payload && !payload.success ? payload.error : "Could not save");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server");
    } finally {
      setSaving(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <select
        value={current}
        disabled={disabled || saving || pending}
        onChange={(e) => void onChange(e.target.value)}
        aria-label="Status"
        style={{
          padding: "6px 10px",
          border: "1px solid #DDD5C9",
          borderRadius: 2,
          background: disabled ? "#F5F1EA" : "#FAF7F2",
          color: "#1C1917",
          fontFamily: "inherit",
          fontSize: "0.8rem",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {error && <span style={{ fontSize: "0.7rem", color: "#991B1B" }}>{error}</span>}
    </span>
  );
}
