import type { Prisma } from "@prisma/client";

import type { PropertyDto } from "@/lib/dto";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { availabilityForMany, describeAvailability } from "@/lib/viewings";

/**
 * Reads for the public site. Every query here carries `status: "PUBLISHED"` — a DRAFT listing
 * is a home the team has not finished writing up, and an ARCHIVED one is sold. Neither may
 * leak through a slug someone kept in a tab.
 */

const publicSelect = {
  id: true,
  slug: true,
  name: true,
  location: true,
  locality: true,
  tagline: true,
  story: true,
  description: true,
  bhk: true,
  bhkNum: true,
  areaLabel: true,
  area: true,
  areaSqft: true,
  pricePaise: true,
  latitude: true,
  longitude: true,
  amenities: true,
  hoodBlurb: true,
  heroImageUrl: true,
  videoUrl: true,
  floorplanUrl: true,
  floorplanNote: true,
  weeklyViewingSlots: true,
  images: { select: { url: true, alt: true }, orderBy: { sortOrder: "asc" } },
  hood: { select: { kind: true, name: true, distance: true }, orderBy: { sortOrder: "asc" } },
} satisfies Prisma.PropertySelect;

type PublicProperty = Prisma.PropertyGetPayload<{ select: typeof publicSelect }>;

function toDto(
  row: PublicProperty,
  availability: PropertyDto["availability"],
): PropertyDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    location: row.location,
    locality: row.locality,
    tagline: row.tagline,
    story: row.story,
    description: row.description,
    bhk: row.bhk,
    bhkNum: row.bhkNum,
    areaLabel: row.areaLabel,
    area: row.area,
    areaSqft: row.areaSqft,
    // BigInt cannot be JSON-serialised; Number is exact well past any real price.
    pricePaise: Number(row.pricePaise),
    latitude: row.latitude,
    longitude: row.longitude,
    amenities: row.amenities,
    hoodBlurb: row.hoodBlurb,
    hood: row.hood,
    heroImageUrl: row.heroImageUrl,
    images: row.images,
    videoUrl: row.videoUrl,
    floorplanUrl: row.floorplanUrl,
    floorplanNote: row.floorplanNote,
    availability,
  };
}

/**
 * The whole published collection, with live availability.
 *
 * Returning every listing in one payload is a deliberate consequence of the product: Nivasa
 * carries a handful of homes at a time by design, so the detail view has nothing left to fetch
 * and switching between homes costs no round trip. If the collection ever passes ~50, this is
 * the function to split — not the components that read it.
 */
export async function listPublishedProperties(): Promise<PropertyDto[]> {
  if (!isDatabaseConfigured()) return [];

  const rows = await prisma.property.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: publicSelect,
  });

  const availability = await availabilityForMany(rows);
  return rows.map((row) =>
    toDto(
      row,
      availability.get(row.id) ?? describeAvailability(row.weeklyViewingSlots, row.weeklyViewingSlots),
    ),
  );
}

export async function findPublishedProperty(slug: string): Promise<PropertyDto | null> {
  if (!isDatabaseConfigured()) return null;

  const row = await prisma.property.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: publicSelect,
  });
  if (!row) return null;

  const availability = await availabilityForMany([row]);
  return toDto(
    row,
    availability.get(row.id) ?? describeAvailability(row.weeklyViewingSlots, row.weeklyViewingSlots),
  );
}

/** Just enough to answer an availability question without loading a whole listing. */
export async function findPublishedPropertyRef(slug: string) {
  if (!isDatabaseConfigured()) return null;
  return prisma.property.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: { id: true, name: true, weeklyViewingSlots: true },
  });
}
