import Link from "next/link";
import type { ReactNode } from "react";

const SERIF = "var(--font-serif)";

/** The quiet frame the sign-in and not-configured screens share. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: "48px 24px",
        background: "linear-gradient(180deg,#FFFFFF 0%,#FAF7F2 100%)",
      }}
    >
      <Link
        href="/"
        style={{
          fontFamily: SERIF,
          fontSize: "1.12rem",
          letterSpacing: "0.18em",
          fontWeight: 700,
          color: "#0A0A0A",
        }}
      >
        NAMA<span style={{ color: "#A16207" }}>NIVASA</span>
      </Link>
      <p
        style={{
          fontSize: "0.72rem",
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: "#A16207",
          fontWeight: 600,
          margin: 0,
        }}
      >
        {title}
      </p>
      {children}
    </main>
  );
}

export function NotConfigured() {
  return (
    <div
      style={{
        maxWidth: 460,
        background: "#fff",
        border: "1px solid #ECE5DB",
        borderRadius: 10,
        padding: "36px 32px",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.4rem", margin: "0 0 12px" }}>
        The team area is not configured
      </h1>
      <p style={{ color: "#57534E", fontSize: "0.94rem", fontWeight: 300, margin: "0 0 18px" }}>
        Set <code>NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and <code>CLERK_SECRET_KEY</code>, then
        restart. The visitor-facing site needs neither and works without them.
      </p>
      <Link
        href="/"
        style={{
          display: "inline-block",
          padding: "12px 24px",
          border: "1px solid #1C1917",
          color: "#1C1917",
          borderRadius: 2,
          fontSize: "0.76rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        Back to homes
      </Link>
    </div>
  );
}
