import type { CSSProperties, ReactNode } from "react";

export const SERIF = "var(--font-serif)";

export const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #ECE5DB",
  borderRadius: 8,
  padding: 24,
};

export const th: CSSProperties = {
  textAlign: "left",
  fontSize: "0.68rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#A8A29E",
  fontWeight: 600,
  padding: "0 12px 12px 0",
  whiteSpace: "nowrap",
};

export const td: CSSProperties = {
  padding: "14px 12px 14px 0",
  borderTop: "1px solid #ECE5DB",
  fontSize: "0.9rem",
  color: "#1C1917",
  verticalAlign: "top",
};

const TONES: Record<string, { bg: string; fg: string }> = {
  NEW: { bg: "#FEF3C7", fg: "#92400E" },
  SCHEDULED: { bg: "#DCFCE7", fg: "#166534" },
  CONTACTED: { bg: "#E0E7FF", fg: "#3730A3" },
  REVIEWING: { bg: "#E0E7FF", fg: "#3730A3" },
  ACCEPTED: { bg: "#DCFCE7", fg: "#166534" },
  CLOSED: { bg: "#F3ECE1", fg: "#57534E" },
  DECLINED: { bg: "#F3ECE1", fg: "#57534E" },
  CANCELLED: { bg: "#FEE2E2", fg: "#991B1B" },
  PUBLISHED: { bg: "#DCFCE7", fg: "#166534" },
  DRAFT: { bg: "#FEF3C7", fg: "#92400E" },
  ARCHIVED: { bg: "#F3ECE1", fg: "#57534E" },
  SENT: { bg: "#DCFCE7", fg: "#166534" },
  AUTO_SENT: { bg: "#DCFCE7", fg: "#166534" },
  PENDING: { bg: "#FEF3C7", fg: "#92400E" },
  PENDING_REVIEW: { bg: "#FEF3C7", fg: "#92400E" },
  AWAITING_REVIEW: { bg: "#FEF3C7", fg: "#92400E" },
  SENDING: { bg: "#E0E7FF", fg: "#3730A3" },
  OPEN: { bg: "#E0E7FF", fg: "#3730A3" },
  DISMISSED: { bg: "#F3ECE1", fg: "#57534E" },
  SKIPPED: { bg: "#F3ECE1", fg: "#57534E" },
  FAILED: { bg: "#FEE2E2", fg: "#991B1B" },
};

export function Pill({ value }: { value: string }) {
  const tone = TONES[value] ?? { bg: "#F3ECE1", fg: "#57534E" };
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

export function PageHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h1 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.8rem", margin: 0, color: "#1C1917" }}>
        {title}
      </h1>
      {sub && <p style={{ color: "#78716C", fontSize: "0.92rem", margin: "8px 0 0" }}>{sub}</p>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div style={card}>
      <p
        style={{
          fontSize: "0.68rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#A8A29E",
          margin: "0 0 8px",
          fontWeight: 600,
        }}
      >
        {label}
      </p>
      <p style={{ fontFamily: SERIF, fontSize: "2rem", margin: 0, color: "#1C1917" }}>{value}</p>
      {hint && <p style={{ fontSize: "0.8rem", color: "#78716C", margin: "6px 0 0" }}>{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p style={{ padding: "48px 0", textAlign: "center", color: "#A8A29E", fontSize: "0.92rem" }}>
      {children}
    </p>
  );
}

/** DD/MM/YYYY, IST — the convention every surface of this app displays dates in. */
export function formatIst(value: Date | string, withTime = false): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
    ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  }).format(date);
}

/** Paise → "₹1.35 Cr". Never a float in storage; formatting is display-only. */
export function formatPaise(paise: number | bigint): string {
  const rupees = Number(paise) / 100;
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(2).replace(/\.?0+$/, "")} Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(2).replace(/\.?0+$/, "")} L`;
  return `₹${Math.round(rupees).toLocaleString("en-IN")}`;
}
