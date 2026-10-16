import type { CSSProperties, ReactNode } from "react";

/**
 * Small pieces every Close screen shares: the money and percentage conversions, the API call
 * wrapper, and the form styles lifted from `listing-form.tsx` so the deal room reads like the
 * rest of the dashboard.
 *
 * **Rupees to paise is string arithmetic, never `* 100`.** A curator types "1,16,00,000.50"; the
 * paise are the digits with the decimal point removed. Multiplying a float would be one paisa
 * short often enough to fail a reconciliation the checker insists on.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Exact conversions
// ─────────────────────────────────────────────────────────────────────────────

/** "1,16,00,000.5" → 11600000050. Null when it is not a non-negative amount with ≤ 2 decimals. */
export function rupeesToPaise(input: string): number | null {
  return scaledByHundred(input);
}

/** 11600000050 → "11600000.50"; whole rupees drop the decimals. Exact for any safe integer. */
export function paiseToRupees(paise: number): string {
  return unscaleHundred(paise);
}

/** "33.33" (percent) → 3333 basis points. */
export function percentToBps(input: string): number | null {
  return scaledByHundred(input);
}

/** 3333 → "33.33". */
export function bpsToPercent(bps: number): string {
  return unscaleHundred(bps);
}

function scaledByHundred(input: string): number | null {
  const clean = input.replace(/[,\s₹]/g, "");
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(clean);
  if (!m) return null;
  const value = Number(`${m[1]}${(m[2] ?? "").padEnd(2, "0")}`);
  return Number.isSafeInteger(value) ? value : null;
}

function unscaleHundred(value: number): string {
  const whole = Math.trunc(value / 100);
  const frac = Math.abs(value % 100);
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** Today's IST calendar date, YYYY-MM-DD. */
export function istToday(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

export type CallResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** fetch + the `ApiResponse` envelope, the way `StatusControl` reads it. */
export async function callApi<T>(url: string, method: string, body?: unknown): Promise<CallResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => null)) as
      | { success: true; data: T }
      | { success: false; error: string }
      | null;
    if (!res.ok || !payload?.success) {
      return {
        ok: false,
        status: res.status,
        error: payload && !payload.success ? payload.error : `Request failed (${res.status})`,
      };
    }
    return { ok: true, data: payload.data };
  } catch {
    return { ok: false, status: 0, error: "Could not reach the server" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles and small components
// ─────────────────────────────────────────────────────────────────────────────

export const input: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #DDD5C9",
  borderRadius: 2,
  background: "#FAF7F2",
  color: "#1C1917",
  fontFamily: "inherit",
  fontSize: "0.85rem",
};

export const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#78716C",
  marginBottom: 4,
};

export const button: CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #DDD5C9",
  borderRadius: 2,
  background: "#FAF7F2",
  color: "#1C1917",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  cursor: "pointer",
};

export function primaryButton(busy: boolean): CSSProperties {
  return {
    ...button,
    background: busy ? "#D6C9B4" : "#A16207",
    borderColor: busy ? "#D6C9B4" : "#A16207",
    color: "#FFFDF9",
    padding: "10px 22px",
    cursor: busy ? "not-allowed" : "pointer",
  };
}

export const dangerButton: CSSProperties = { ...button, color: "#991B1B", borderColor: "#FCA5A5" };

export function Field({ children, hint, text }: { children: ReactNode; hint?: string; text: string }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={fieldLabel}>{text}</span>
      {children}
      {hint && (
        <span style={{ display: "block", fontSize: "0.7rem", color: "#78716C", marginTop: 4 }}>{hint}</span>
      )}
    </label>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid #E7E0D6",
        borderRadius: 3,
        padding: 20,
        marginBottom: 20,
        background: "#FFFDF9",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h2
          style={{
            fontSize: "0.72rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#A16207",
            margin: 0,
          }}
        >
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: "0.8rem", color: "#991B1B" }}>{children}</span>;
}

/** "12 days left" / "3 days overdue" — red at ten days or fewer, and when past. */
export function Countdown({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return <span style={{ color: "#A8A29E" }}>no deadline yet</span>;
  const urgent = daysLeft <= 10;
  const text =
    daysLeft < 0
      ? `${-daysLeft} day${daysLeft === -1 ? "" : "s"} overdue`
      : daysLeft === 0
        ? "due today"
        : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`;
  return (
    <span style={{ color: urgent ? "#991B1B" : "#3F6212", fontWeight: urgent ? 600 : 400, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

const DEAL_TONES: Record<string, { bg: string; fg: string }> = {
  DRAFT: { bg: "#FEF3C7", fg: "#92400E" },
  ACTIVE: { bg: "#DCFCE7", fg: "#166534" },
  AT_RISK: { bg: "#FEE2E2", fg: "#991B1B" },
  CLOSED: { bg: "#F3ECE1", fg: "#57534E" },
  CANCELLED: { bg: "#F3ECE1", fg: "#78716C" },
  IN_PROGRESS: { bg: "#E0E7FF", fg: "#3730A3" },
  DONE: { bg: "#DCFCE7", fg: "#166534" },
  BLOCKED: { bg: "#FEE2E2", fg: "#991B1B" },
};

/** `Pill` with the deal statuses `ui.tsx` does not know — AT_RISK must read red, not neutral. */
export function DealPill({ value }: { value: string }) {
  const tone = DEAL_TONES[value] ?? { bg: "#F3ECE1", fg: "#57534E" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 20,
        background: tone.bg,
        color: tone.fg,
        fontSize: "0.68rem",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

export const PAYMENT_KINDS = [
  "TOKEN",
  "BOOKING",
  "SELF_FUNDING",
  "LOAN_DISBURSAL",
  "SELLER_LOAN_PAYOFF",
  "TDS",
  "BALANCE",
  "OTHER",
] as const;

export const DOCUMENT_KINDS = [
  { kind: "MOU", label: "MOU" },
  { kind: "LOU", label: "Letter of understanding" },
  { kind: "BANK_NOC_LOD_REQUEST", label: "Bank: conditional NOC + LOD request" },
  { kind: "BANK_FORECLOSURE_REQUEST", label: "Bank: foreclosure request" },
  { kind: "BANK_FOLLOW_UP", label: "Bank: follow-up" },
] as const;
