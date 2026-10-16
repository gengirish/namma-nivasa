import Link from "next/link";
import type { ReactNode } from "react";

import { AuthShell, NotConfigured } from "@/components/auth-shell";
import { BootstrapPanel } from "@/components/dashboard/bootstrap-panel";
import { ClerkBoundary } from "@/components/clerk-boundary";
import { SERIF } from "@/components/dashboard/ui";
import { getClerkUserId, getSession, isAuthConfigured } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const metadata = { title: "Dashboard — Nivasa" };

const NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/enquiries", label: "Enquiries" },
  { href: "/dashboard/submissions", label: "Owner intake" },
  { href: "/dashboard/properties", label: "Listings" },
  { href: "/dashboard/deals", label: "Deals" },
  { href: "/dashboard/inbox", label: "Inbox" },
  { href: "/dashboard/outbox", label: "Outbox" },
];

/**
 * The dashboard's own gate, beside the middleware's.
 *
 * Middleware only answers "is anyone signed in". Whether that person is on the team is a
 * database question, so it is answered here — and the two failure modes are shown differently,
 * because "sign in" and "you are signed in but not on the team" need different next steps.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  if (!isAuthConfigured() || !isDatabaseConfigured()) {
    return (
      <AuthShell title="Dashboard">
        <NotConfigured />
      </AuthShell>
    );
  }

  const session = await getSession();
  if (!session) {
    const [teamExists, clerkUserId] = await Promise.all([
      prisma.admin.count().then((n) => n > 0).catch(() => true),
      getClerkUserId(),
    ]);
    return (
      <ClerkBoundary>
        <AuthShell title="Dashboard">
          <BootstrapPanel teamExists={teamExists} signedIn={Boolean(clerkUserId)} />
        </AuthShell>
      </ClerkBoundary>
    );
  }

  return (
    <ClerkBoundary>
      <div style={{ minHeight: "100vh", background: "#FAF7F2" }}>
        <header
          style={{
            background: "#1C1917",
            color: "#fff",
            padding: "0 24px",
            position: "sticky",
            top: 0,
            zIndex: 40,
          }}
        >
          <div
            style={{
              maxWidth: 1200,
              margin: "0 auto",
              height: 66,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 24,
            }}
          >
            <Link
              href="/"
              style={{
                fontFamily: SERIF,
                fontSize: "1rem",
                letterSpacing: "0.18em",
                fontWeight: 700,
                color: "#fff",
              }}
            >
              NAMA<span style={{ color: "#C99A3F" }}>NIVASA</span>
            </Link>
            <nav style={{ display: "flex", gap: 22, flexWrap: "wrap", fontSize: "0.84rem" }}>
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="nv-footlink" style={{ color: "#D6D3D1" }}>
                  {item.label}
                </Link>
              ))}
            </nav>
            <span style={{ fontSize: "0.78rem", color: "#B7B2AC", whiteSpace: "nowrap" }}>
              {session.name || session.email} · {session.role}
            </span>
          </div>
        </header>

        <main style={{ maxWidth: 1200, margin: "0 auto", padding: "36px 24px 80px" }}>{children}</main>
      </div>
    </ClerkBoundary>
  );
}
