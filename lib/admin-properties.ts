import { Prisma, type PropertyStatus } from "@prisma/client";
import { z } from "zod";

import { DomainError } from "@/lib/auth";
import { parseInrToPaise } from "@/lib/price";
import { prisma } from "@/lib/prisma";
import { propertyCreateSchema, propertyUpdateSchema, slugify } from "@/lib/validations";

/**
 * Writes to the catalogue. Kept out of the route handlers because each one is a
 * `$transaction` — a listing is one row plus two child collections, and a half-written listing
 * is worse than a rejected one.
 *
 * Gallery and neighbourhood rows are replaced wholesale rather than diffed. For a collection
 * this size the diff buys nothing, and "the array you sent is what the listing now has" is a
 * rule a curator can hold in their head.
 */

type CreateInput = z.infer<typeof propertyCreateSchema>;
type UpdateInput = z.infer<typeof propertyUpdateSchema>;

function emptyToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}

export async function createProperty(input: CreateInput) {
  const slug = input.slug ?? slugify(input.name);
  if (slug.length < 3) throw new DomainError("Choose a URL with at least 3 letters or numbers");

  try {
    return await prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          slug,
          name: input.name,
          location: input.location,
          locality: input.locality,
          tagline: input.tagline,
          story: input.story,
          description: input.description,
          bhk: input.bhk,
          bhkNum: input.bhkNum,
          areaLabel: input.areaLabel,
          area: input.area,
          areaSqft: input.areaSqft,
          pricePaise: BigInt(input.pricePaise),
          latitude: input.latitude,
          longitude: input.longitude,
          amenities: input.amenities,
          hoodBlurb: input.hoodBlurb,
          heroImageUrl: input.heroImageUrl,
          videoUrl: emptyToNull(input.videoUrl),
          floorplanUrl: emptyToNull(input.floorplanUrl),
          floorplanNote: input.floorplanNote ?? null,
          weeklyViewingSlots: input.weeklyViewingSlots,
          ownerEmail: emptyToNull(input.ownerEmail),
          // status stays DRAFT. Publishing is a PATCH, so it is always a deliberate act.
        },
        select: { id: true, slug: true },
      });

      await writeChildren(tx, property.id, input.images, input.hood);
      return property;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new DomainError("That listing URL is already taken", 409);
    }
    throw err;
  }
}

export async function updateProperty(id: string, input: UpdateInput, adminId: string) {
  const existing = await prisma.property.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      publishedAt: true,
      tagline: true,
      story: true,
      heroImageUrl: true,
      pricePaise: true,
      latitude: true,
      longitude: true,
    },
  });
  if (!existing) throw new DomainError("That listing no longer exists", 404);

  const goingLive = input.status === "PUBLISHED" && existing.status !== "PUBLISHED";
  if (goingLive) {
    const missing = missingForPublish({
      tagline: input.tagline ?? existing.tagline,
      story: input.story ?? existing.story,
      heroImageUrl: input.heroImageUrl ?? existing.heroImageUrl,
      pricePaise: input.pricePaise !== undefined ? BigInt(input.pricePaise) : existing.pricePaise,
      latitude: input.latitude ?? existing.latitude,
      longitude: input.longitude ?? existing.longitude,
    });
    if (missing.length > 0) {
      throw new DomainError(`Add ${missing.join(", ")} before publishing`, 422);
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const property = await tx.property.update({
        where: { id },
        data: {
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.locality !== undefined ? { locality: input.locality } : {}),
          ...(input.tagline !== undefined ? { tagline: input.tagline } : {}),
          ...(input.story !== undefined ? { story: input.story } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.bhk !== undefined ? { bhk: input.bhk } : {}),
          ...(input.bhkNum !== undefined ? { bhkNum: input.bhkNum } : {}),
          ...(input.areaLabel !== undefined ? { areaLabel: input.areaLabel } : {}),
          ...(input.area !== undefined ? { area: input.area } : {}),
          ...(input.areaSqft !== undefined ? { areaSqft: input.areaSqft } : {}),
          ...(input.pricePaise !== undefined ? { pricePaise: BigInt(input.pricePaise) } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.amenities !== undefined ? { amenities: input.amenities } : {}),
          ...(input.hoodBlurb !== undefined ? { hoodBlurb: input.hoodBlurb } : {}),
          ...(input.heroImageUrl !== undefined ? { heroImageUrl: input.heroImageUrl } : {}),
          ...(input.videoUrl !== undefined ? { videoUrl: emptyToNull(input.videoUrl) } : {}),
          ...(input.floorplanUrl !== undefined
            ? { floorplanUrl: emptyToNull(input.floorplanUrl) }
            : {}),
          ...(input.floorplanNote !== undefined ? { floorplanNote: input.floorplanNote } : {}),
          ...(input.weeklyViewingSlots !== undefined
            ? { weeklyViewingSlots: input.weeklyViewingSlots }
            : {}),
          ...(input.ownerEmail !== undefined ? { ownerEmail: emptyToNull(input.ownerEmail) } : {}),
          ...(input.status !== undefined ? { status: input.status as PropertyStatus } : {}),
          // Stamped once, on the first publish. Re-publishing after an archive keeps the
          // original date — that is when the home reached the collection.
          ...(goingLive && !existing.publishedAt
            ? { publishedAt: new Date(), publishedBy: adminId }
            : {}),
        },
        select: { id: true, slug: true, status: true },
      });

      if (input.images !== undefined || input.hood !== undefined) {
        await writeChildren(tx, id, input.images, input.hood);
      }
      return property;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new DomainError("That listing URL is already taken", 409);
    }
    throw err;
  }
}

/**
 * What a listing cannot go live without. A draft may hold blanks — one made from owner intake
 * starts with no photo, no copy and no map pin — but the public page has no sensible rendering
 * of any of them, and a ₹0 price or a pin in the Gulf of Guinea reads as a real claim.
 */
function missingForPublish(p: {
  tagline: string;
  story: string;
  heroImageUrl: string;
  pricePaise: bigint;
  latitude: number;
  longitude: number;
}): string[] {
  return [
    p.heroImageUrl.trim() ? null : "a hero photo",
    p.tagline.trim() ? null : "a tagline",
    p.story.trim() ? null : "the story",
    p.pricePaise > BigInt(0) ? null : "a price",
    p.latitude === 0 && p.longitude === 0 ? "the map location" : null,
  ].filter((x): x is string => x !== null);
}

/**
 * Owner intake → a DRAFT listing, carrying over what the owner told us and nothing invented.
 *
 * Idempotent by construction, not by a prior read: `OwnerSubmission.propertyId` is `@unique`,
 * and the link is claimed with a conditional update inside the same transaction as the create.
 * Two curators clicking at once both create a row; one claim matches nothing, its transaction
 * rolls back, and both are sent to the listing that won.
 *
 * The owner's free text goes to `privateNote`, never to the public copy — it is where loan
 * details and co-owners' names turn up.
 */
export async function createListingFromSubmission(
  submissionId: string,
): Promise<{ id: string; created: boolean }> {
  const sub = await prisma.ownerSubmission.findUnique({ where: { id: submissionId } });
  if (!sub) throw new DomainError("That submission no longer exists", 404);
  if (sub.propertyId) return { id: sub.propertyId, created: false };
  if (sub.status !== "ACCEPTED") throw new DomainError("Accept the submission first", 409);

  const [first, second] = sub.locality.split(",").map((part) => part.trim());
  const name = first || sub.locality.trim();
  let slug = slugify(name);
  if (slug.length < 3 || (await prisma.property.findUnique({ where: { slug }, select: { id: true } }))) {
    slug = `${slug}-${sub.reference.slice(-4).toLowerCase()}`.replace(/^-/, "");
  }

  const privateNote =
    [
      `From owner intake ${sub.reference} — ${sub.name}, ${sub.phone}.`,
      sub.expectedPrice ? `Asking: ${sub.expectedPrice}` : null,
      sub.timeline ? `Timeline: ${sub.timeline}` : null,
      sub.mediaCount ? `Media on hand: ${sub.mediaCount} file(s)` : null,
      sub.message ? `Owner wrote: ${sub.message}` : null,
      sub.notes ? `Triage notes: ${sub.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

  try {
    const id = await prisma.$transaction(async (tx) => {
      const property = await tx.property.create({
        data: {
          slug,
          name,
          location: sub.locality,
          locality: second || name,
          tagline: "",
          story: "",
          description: [],
          bhk: sub.config ?? "",
          bhkNum: Number.parseInt(sub.config ?? "", 10) || 0,
          areaLabel: "Area",
          area: sub.areaSqft ? `${sub.areaSqft.toLocaleString("en-IN")} sqft` : "",
          areaSqft: sub.areaSqft ?? 0,
          pricePaise: parseInrToPaise(sub.expectedPrice) ?? BigInt(0),
          // 0,0 is "not placed yet" — missingForPublish() refuses it.
          latitude: 0,
          longitude: 0,
          amenities: [],
          hoodBlurb: "",
          heroImageUrl: "",
          weeklyViewingSlots: 3,
          ownerEmail: sub.email,
          privateNote,
          // status stays DRAFT, as with createProperty.
        },
        select: { id: true },
      });

      const claimed = await tx.ownerSubmission.updateMany({
        where: { id: sub.id, propertyId: null, status: "ACCEPTED" },
        data: { propertyId: property.id },
      });
      if (claimed.count === 0) throw new LostClaim();
      return property.id;
    });
    return { id, created: true };
  } catch (err) {
    // A concurrent click usually loses on the slug index before it reaches the claim — both
    // computed the same slug. Either way, the winner's listing is the answer.
    const slugTaken = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
    if (err instanceof LostClaim || slugTaken) {
      const now = await prisma.ownerSubmission.findUnique({
        where: { id: sub.id },
        select: { propertyId: true },
      });
      if (now?.propertyId) return { id: now.propertyId, created: false };
      if (slugTaken) throw new DomainError("A listing with that URL already exists — try again", 409);
      throw new DomainError("Accept the submission first", 409);
    }
    throw err;
  }
}

class LostClaim extends Error {}

async function writeChildren(
  tx: Prisma.TransactionClient,
  propertyId: string,
  images?: CreateInput["images"],
  hood?: CreateInput["hood"],
) {
  if (images !== undefined) {
    await tx.propertyImage.deleteMany({ where: { propertyId } });
    if (images.length > 0) {
      await tx.propertyImage.createMany({
        data: images.map((image, index) => ({ propertyId, ...image, sortOrder: index })),
      });
    }
  }
  if (hood !== undefined) {
    await tx.hoodPlace.deleteMany({ where: { propertyId } });
    if (hood.length > 0) {
      await tx.hoodPlace.createMany({
        data: hood.map((place, index) => ({ propertyId, ...place, sortOrder: index })),
      });
    }
  }
}

/**
 * Archiving, never deleting. A listing owns the enquiries it produced, and hard-deleting it
 * would take a year of demand history with it — `Enquiry.propertyId` is `ON DELETE SET NULL`
 * precisely so an accidental delete cannot orphan a lead, but the history is still gone.
 */
export async function archiveProperty(id: string) {
  const result = await prisma.property.updateMany({
    where: { id },
    data: { status: "ARCHIVED" },
  });
  if (result.count === 0) throw new DomainError("That listing no longer exists", 404);
}
