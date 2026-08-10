import { StatusControl } from "@/components/dashboard/status-control";
import {
  Empty,
  PageHeading,
  Pill,
  card,
  formatIst,
  formatPaise,
  td,
  th,
} from "@/components/dashboard/ui";
import { hasRole, requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { weekOf } from "@/lib/slots";

export const dynamic = "force-dynamic";

const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

export default async function PropertiesPage() {
  const session = await requireRole("VIEWER");
  const canEdit = hasRole(session.role, "CURATOR");
  const week = weekOf();

  const [properties, bookedRows] = await Promise.all([
    prisma.property.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: { _count: { select: { enquiries: true } } },
    }),
    prisma.viewing.groupBy({
      by: ["propertyId"],
      where: { status: { not: "CANCELLED" }, scheduledFor: { gte: week.start, lt: week.end } },
      _count: { _all: true },
    }),
  ]);

  const bookedByProperty = new Map(bookedRows.map((r) => [r.propertyId, r._count._all]));

  return (
    <>
      <PageHeading
        title="Listings"
        sub="Publishing is a status change, so it is always deliberate. Archived homes keep their enquiry history."
      />

      <div style={{ ...card, overflowX: "auto" }}>
        {properties.length === 0 ? (
          <Empty>No listings yet. Seed the catalogue or POST to /api/admin/properties.</Empty>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr>
                <th style={th}>Home</th>
                <th style={th}>Config</th>
                <th style={th}>Price</th>
                <th style={th}>This week</th>
                <th style={th}>Enquiries</th>
                <th style={th}>Updated</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((p) => {
                const booked = bookedByProperty.get(p.id) ?? 0;
                const left = Math.max(0, p.weeklyViewingSlots - booked);
                return (
                  <tr key={p.id}>
                    <td style={td}>
                      <div>{p.name}</div>
                      <div style={{ fontSize: "0.82rem", color: "#78716C" }}>{p.location}</div>
                      <div style={{ fontSize: "0.78rem", color: "#A8A29E" }}>/{p.slug}</div>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{p.bhk}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{formatPaise(p.pricePaise)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <span style={{ color: left === 0 ? "#991B1B" : "#166534" }}>
                        {left} of {p.weeklyViewingSlots} left
                      </span>
                    </td>
                    <td style={td}>{p._count.enquiries}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: "#78716C" }}>
                      {formatIst(p.updatedAt)}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <Pill value={p.status} />
                        <StatusControl
                          endpoint={`/api/admin/properties/${p.id}`}
                          current={p.status}
                          options={STATUSES}
                          disabled={!canEdit}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
