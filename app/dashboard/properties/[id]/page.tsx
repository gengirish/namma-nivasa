import Link from "next/link";
import { notFound } from "next/navigation";

import { ListingForm } from "@/components/dashboard/listing-form";
import { PageHeading } from "@/components/dashboard/ui";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * The listing editor — the only way to change a home's copy without a connection string.
 *
 * Reads the full row rather than a DTO. `publicSelect` in `lib/properties.ts` is an allowlist
 * built for browsers and deliberately omits `ownerEmail`; a curator editing the listing is
 * exactly who should see it.
 */
export const dynamic = "force-dynamic";

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  // CURATOR or above. A VIEWER never reaches this page, which is why the form below has no
  // read-only mode to maintain.
  await requireRole("CURATOR");
  const { id } = await params;

  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      images: { orderBy: { sortOrder: "asc" }, select: { url: true, alt: true } },
      hood: { orderBy: { sortOrder: "asc" }, select: { kind: true, name: true, distance: true } },
    },
  });
  if (!property) notFound();

  return (
    <>
      <PageHeading
        title={property.name}
        sub={`/${property.slug} · ${property.status} — saving here does not publish or unpublish; status stays where it is.`}
      />

      <p style={{ margin: "-12px 0 24px" }}>
        <Link href="/dashboard/properties" style={{ color: "#A16207", fontSize: "0.85rem" }}>
          ← All listings
        </Link>
      </p>

      <ListingForm
        id={property.id}
        slug={property.slug}
        initial={{
          slug: property.slug,
          name: property.name,
          location: property.location,
          locality: property.locality,
          tagline: property.tagline,
          story: property.story,
          description: property.description,
          bhk: property.bhk,
          bhkNum: property.bhkNum,
          areaLabel: property.areaLabel,
          area: property.area,
          areaSqft: property.areaSqft,
          // Paise are the storage unit; rupees are what a curator thinks in. Converted here so
          // the form never has to explain the difference.
          priceRupees: Number(property.pricePaise) / 100,
          latitude: property.latitude,
          longitude: property.longitude,
          amenities: property.amenities,
          hoodBlurb: property.hoodBlurb,
          heroImageUrl: property.heroImageUrl,
          videoUrl: property.videoUrl ?? "",
          floorplanUrl: property.floorplanUrl ?? "",
          floorplanNote: property.floorplanNote ?? "",
          ownerEmail: property.ownerEmail ?? "",
          weeklyViewingSlots: property.weeklyViewingSlots,
          images: property.images,
          hood: property.hood,
        }}
      />
    </>
  );
}
