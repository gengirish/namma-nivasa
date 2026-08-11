import { Prisma, type PropertyStatus } from "@prisma/client";
import { z } from "zod";

import { DomainError } from "@/lib/auth";
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
    select: { id: true, status: true, publishedAt: true },
  });
  if (!existing) throw new DomainError("That listing no longer exists", 404);

  const goingLive = input.status === "PUBLISHED" && existing.status !== "PUBLISHED";

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
