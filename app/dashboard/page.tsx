import Link from "next/link";

import { PageHeading, Stat, card, formatIst, SERIF } from "@/components/dashboard/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slotLabel, weekOf } from "@/lib/slots";

export const dynamic = "force-dynamic";

/**
 * What the team needs to see first: what is waiting for a reply, and who is arriving.
 * Every figure is a live count — nothing here is a cached rollup that can drift.
 */
export default async function DashboardOverview() {
  await requireRole("VIEWER");

  const week = weekOf();
  const now = new Date();

  const [newEnquiries, upcoming, newSubmissions, published, drafts, bookedThisWeek, subscribers] =
    await Promise.all([
      prisma.enquiry.count({ where: { status: "NEW" } }),
      prisma.viewing.findMany({
        where: { status: "BOOKED", scheduledFor: { gte: now } },
        orderBy: { scheduledFor: "asc" },
        take: 8,
        include: {
          property: { select: { name: true } },
          enquiry: { select: { name: true, phone: true, reference: true, kind: true } },
        },
      }),
      prisma.ownerSubmission.count({ where: { status: "NEW" } }),
      prisma.property.count({ where: { status: "PUBLISHED" } }),
      prisma.property.count({ where: { status: "DRAFT" } }),
      prisma.viewing.count({
        where: { status: { not: "CANCELLED" }, scheduledFor: { gte: week.start, lt: week.end } },
      }),
      prisma.subscriber.count({ where: { unsubscribedAt: null } }),
    ]);

  return (
    <>
      <PageHeading title="Overview" sub="Live counts — nothing here is cached." />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
          gap: 18,
          marginBottom: 36,
        }}
      >
        <Stat label="New enquiries" value={newEnquiries} hint="Waiting for a first reply" />
        <Stat label="Booked this week" value={bookedThisWeek} hint="Across every listing" />
        <Stat label="Owner submissions" value={newSubmissions} hint="Not yet reviewed" />
        <Stat
          label="Listings"
          value={published}
          hint={drafts > 0 ? `${drafts} draft${drafts === 1 ? "" : "s"} unpublished` : "All published"}
        />
        <Stat label="Subscribers" value={subscribers} hint="Opted in to the list" />
      </div>

      <div style={card}>
        <h2 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.2rem", margin: "0 0 4px" }}>
          Next viewings
        </h2>
        <p style={{ color: "#78716C", fontSize: "0.86rem", margin: "0 0 20px" }}>
          Everyone expected at a door, soonest first.
        </p>

        {upcoming.length === 0 ? (
          <p style={{ color: "#A8A29E", fontSize: "0.9rem", margin: 0 }}>
            Nothing booked yet. Slots open up on every published listing.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {upcoming.map((v) => (
              <div
                key={v.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                  borderTop: "1px solid #ECE5DB",
                  paddingTop: 12,
                }}
              >
                <div>
                  <p style={{ margin: 0, fontSize: "0.95rem", color: "#1C1917" }}>
                    {v.enquiry.name} · {v.enquiry.phone}
                  </p>
                  <p style={{ margin: "3px 0 0", fontSize: "0.82rem", color: "#78716C" }}>
                    {v.property.name} ·{" "}
                    {v.enquiry.kind === "OWNER_CALL" ? "Owner call" : "Site visit"} ·{" "}
                    {v.enquiry.reference}
                  </p>
                </div>
                <p style={{ margin: 0, fontSize: "0.9rem", color: "#A16207", whiteSpace: "nowrap" }}>
                  {formatIst(v.scheduledFor)} · {slotLabel(v.scheduledFor)}
                </p>
              </div>
            ))}
          </div>
        )}

        <p style={{ margin: "22px 0 0", fontSize: "0.84rem" }}>
          <Link href="/dashboard/enquiries" style={{ color: "#A16207" }}>
            Open the enquiry inbox →
          </Link>
        </p>
      </div>
    </>
  );
}
