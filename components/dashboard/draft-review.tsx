"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * The approve-or-throw-away control for one drafted reply.
 *
 * The body is an editable textarea, not a preview. A curator who has to reject a draft because
 * one sentence is wrong will eventually stop reading them; letting them fix the sentence and
 * send is what keeps review a habit rather than a chore. The edited text is what goes out and
 * what is stored, so the record matches what the person received.
 *
 * Send is destructive in the only sense that matters here — it reaches a real person and cannot
 * be recalled — so it asks first, and it stays disabled for VIEWERs rather than failing on click.
 */
export function DraftReview({
  draftId,
  initialSubject,
  initialBody,
  disabled,
}: {
  draftId: string;
  initialSubject: string;
  initialBody: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState<"send" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const edited = subject !== initialSubject || body !== initialBody;
  const locked = disabled || busy !== null || pending;

  const act = async (action: "send" | "dismiss") => {
    if (action === "send") {
      const ok = window.confirm(
        `Send this reply to the enquirer?\n\nSubject: ${subject}\n\nThis cannot be unsent.`,
      );
      if (!ok) return;
    }

    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/drafts/${draftId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "send" ? { action, subject, body } : { action }),
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
      setBusy(null);
    }
  };

  const field: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #DDD5C9",
    borderRadius: 2,
    background: locked ? "#F5F1EA" : "#fff",
    color: "#1C1917",
    fontFamily: "inherit",
    fontSize: "0.85rem",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={locked}
        aria-label="Reply subject"
        style={field}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={locked}
        rows={9}
        aria-label="Reply body"
        style={{ ...field, resize: "vertical", lineHeight: 1.55 }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void act("send")}
          disabled={locked || !body.trim() || !subject.trim()}
          style={{
            padding: "8px 18px",
            border: "none",
            borderRadius: 2,
            background: locked ? "#A8A29E" : "#1C1917",
            color: "#fff",
            fontFamily: "inherit",
            fontSize: "0.82rem",
            letterSpacing: "0.04em",
            cursor: locked ? "not-allowed" : "pointer",
          }}
        >
          {busy === "send" ? "Sending…" : edited ? "Send edited reply" : "Send reply"}
        </button>

        <button
          type="button"
          onClick={() => void act("dismiss")}
          disabled={locked}
          style={{
            padding: "8px 18px",
            border: "1px solid #DDD5C9",
            borderRadius: 2,
            background: "transparent",
            color: "#57534E",
            fontFamily: "inherit",
            fontSize: "0.82rem",
            cursor: locked ? "not-allowed" : "pointer",
          }}
        >
          {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>

        {edited && !busy && (
          <span style={{ fontSize: "0.72rem", color: "#92400E" }}>Edited — your text will be sent</span>
        )}
        {error && <span style={{ fontSize: "0.72rem", color: "#991B1B" }}>{error}</span>}
      </div>
    </div>
  );
}
