"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { DOCUMENT_KINDS, Section, button, callApi, input, primaryButton, ErrorText } from "@/components/dashboard/deal-shared";
import { formatIst } from "@/components/dashboard/ui";
import type { ConsistencyIssue, DealDetailDto, DealDocumentSummaryDto } from "@/lib/deal-types";

/**
 * Document rendering. Every render is a stored version; a version whose sheet has since changed
 * is marked stale rather than rewritten, because what was already sent or signed must not move.
 *
 * Full PANs (handover §7) are typed into the final-render dialog, sent in that one request, and
 * forgotten: the stored version is masked, so the copy carrying full PANs exists only as the
 * HTML the response returns. It is opened from a Blob URL in a new window and never written
 * anywhere — print it from there.
 *
 * Whether a final MOU may be rendered is the server's `checkDealConsistency()` to decide; a
 * refusal comes back as a 422 and is shown beside the button that asked.
 */

const PAN_SHAPE = /^[A-Z]{5}\d{4}[A-Z]$/;

interface RenderResult {
  document: DealDocumentSummaryDto;
  html: string;
  issues: ConsistencyIssue[];
}

function partyNames(deal: DealDetailDto): { name: string; role: string }[] {
  if (deal.sheet) {
    return [
      ...deal.sheet.sellers.map((s) => ({ name: s.name, role: "Seller" })),
      { name: deal.sheet.buyer.name, role: "Buyer" },
    ];
  }
  return deal.parties
    .filter((p) => p.role === "SELLER" || p.role === "BUYER")
    .map((p) => ({ name: p.name, role: p.role === "SELLER" ? "Seller" : "Buyer" }));
}

function PanDialog({
  kind,
  parties,
  busy,
  onCancel,
  onRender,
}: {
  kind: string;
  parties: { name: string; role: string }[];
  busy: boolean;
  onCancel: () => void;
  onRender: (pans: Record<string, string>) => void;
}) {
  const [pans, setPans] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const entered = Object.fromEntries(
      Object.entries(pans)
        .map(([k, v]) => [k, v.trim().toUpperCase()] as const)
        .filter(([, v]) => v.length > 0),
    );
    const bad = Object.entries(entered).find(([, v]) => !PAN_SHAPE.test(v));
    if (bad) {
      setError(`The PAN for ${bad[0]} does not look like ABCDE1234F`);
      return;
    }
    setPans({});
    onRender(entered);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Render final ${kind}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,25,23,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
    >
      <div style={{ background: "#FFFDF9", borderRadius: 4, padding: 24, width: "min(100%, 480px)", border: "1px solid #E7E0D6" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>Render final {kind.replace(/_/g, " ")}</h3>
        <p style={{ fontSize: "0.82rem", color: "#57534E", margin: "0 0 16px" }}>
          Full PANs are optional. If entered, they are <strong>used for this render only, never stored</strong>: the
          saved version shows the last four, and the copy with full PANs opens in a new window for you to print.
        </p>
        {parties.map((p) => (
          <label key={p.name} style={{ display: "block", marginBottom: 12 }}>
            <span style={{ display: "block", fontSize: "0.72rem", color: "#78716C", marginBottom: 4 }}>
              {p.role}: {p.name}
            </span>
            <input
              style={{ ...input, textTransform: "uppercase", fontFamily: "ui-monospace, monospace" }}
              autoComplete="off"
              spellCheck={false}
              maxLength={10}
              placeholder="Full PAN (optional)"
              value={pans[p.name] ?? ""}
              onChange={(e) => setPans((x) => ({ ...x, [p.name]: e.target.value }))}
            />
          </label>
        ))}
        {error && (
          <p style={{ margin: "0 0 12px" }}>
            <ErrorText>{error}</ErrorText>
          </p>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" style={primaryButton(busy)} disabled={busy} onClick={submit}>
            {busy ? "Rendering…" : "Render final"}
          </button>
          <button
            type="button"
            style={button}
            disabled={busy}
            onClick={() => {
              setPans({});
              onCancel();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function DealDocuments({ deal }: { deal: DealDetailDto }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<{ kind: string; list: ConsistencyIssue[] } | null>(null);
  const [dialogKind, setDialogKind] = useState<string | null>(null);

  async function render(kind: string, final: boolean, fullPans?: Record<string, string>) {
    const withPans = Boolean(fullPans && Object.keys(fullPans).length);
    // Opened inside the click so a popup blocker allows it; filled once the render returns.
    const win = withPans ? window.open("", "_blank") : null;

    setBusyKind(kind);
    setErrors((e) => ({ ...e, [kind]: "" }));
    const res = await callApi<RenderResult>(`/api/admin/deals/${deal.id}/documents`, "POST", {
      kind,
      final,
      ...(withPans ? { fullPans } : {}),
    });
    setBusyKind(null);
    setDialogKind(null);

    if (!res.ok) {
      win?.close();
      setErrors((e) => ({ ...e, [kind]: res.error }));
      return;
    }

    if (win) {
      const url = URL.createObjectURL(new Blob([res.data.html], { type: "text/html" }));
      win.location.href = url;
      // Long enough for the window to load it; after that the only copy is the one on screen.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    setIssues({ kind, list: res.data.issues });
    startTransition(() => router.refresh());
  }

  const parties = partyNames(deal);
  const noSheet = deal.sheet === null;

  return (
    <Section title="Documents">
      <p style={{ fontSize: "0.8rem", color: "#78716C", margin: "0 0 14px" }}>
        Every document carries a “draft for review” banner until the templates have been vetted by an advocate.
        {noSheet && " Rendering waits until the sheet validates."}
      </p>

      {DOCUMENT_KINDS.map(({ kind, label }) => {
        const versions = deal.documents
          .filter((d) => d.kind === kind)
          .sort((a, b) => b.version - a.version);
        const busy = busyKind !== null || pending || noSheet;
        return (
          <div key={kind} style={{ borderTop: "1px solid #ECE5DB", padding: "12px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ fontSize: "0.9rem" }}>{label}</strong>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" style={button} disabled={busy} onClick={() => void render(kind, false)}>
                  {busyKind === kind ? "Rendering…" : "Render draft"}
                </button>
                <button type="button" style={button} disabled={busy} onClick={() => setDialogKind(kind)}>
                  Render final
                </button>
              </div>
            </div>
            {errors[kind] && (
              <p style={{ margin: "8px 0 0", padding: "8px 10px", background: "#FEF2F2", border: "1px solid #FCA5A5" }}>
                <ErrorText>{errors[kind]}</ErrorText>
              </p>
            )}
            {versions.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", fontSize: "0.82rem" }}>
                {versions.map((v) => (
                  <li key={v.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "3px 0" }}>
                    <a
                      href={`/api/admin/deals/${deal.id}/documents/${v.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#A16207" }}
                    >
                      v{v.version}
                    </a>
                    <span style={{ color: v.final ? "#166534" : "#78716C" }}>{v.final ? "final" : "draft"}</span>
                    <span style={{ color: "#A8A29E" }}>{formatIst(v.createdAt, true)}</span>
                    {v.stale && (
                      <span
                        title="The sheet has changed since this version was rendered"
                        style={{ background: "#FEF3C7", color: "#92400E", padding: "1px 8px", borderRadius: 10, fontSize: "0.68rem", fontWeight: 600 }}
                      >
                        STALE
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {issues?.kind === kind && issues.list.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.8rem" }}>
                {issues.list.map((i, n) => (
                  <li key={n} style={{ color: i.severity === "error" ? "#991B1B" : "#92400E" }}>
                    Rule {i.rule}: {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {dialogKind && (
        <PanDialog
          kind={dialogKind}
          parties={parties}
          busy={busyKind !== null}
          onCancel={() => setDialogKind(null)}
          onRender={(pans) => void render(dialogKind, true, pans)}
        />
      )}
    </Section>
  );
}
