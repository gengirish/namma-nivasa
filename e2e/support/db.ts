/**
 * Direct database access for the specs.
 *
 * E2E here means the real Next server against a real Postgres — the visitor UI is server-rendered
 * from the catalogue, so there is no useful "mock the API" version of these tests. The database
 * is used for three things and no more: reading what the page is *supposed* to show, arranging
 * preconditions the UI cannot reach (a fully-booked week, an unpublished listing), and asserting
 * what a submission actually wrote.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

import { databaseUrl } from "./env";
import { addDays, istInstant, mondayOf } from "./ist";

let client: PrismaClient | null = null;

export function db(): PrismaClient {
  if (!client) {
    const url = databaseUrl();
    client = url ? new PrismaClient({ datasourceUrl: url }) : new PrismaClient();
  }
  return client;
}

export async function disconnectDb(): Promise<void> {
  await client?.$disconnect();
  client = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads the specs assert against
// ─────────────────────────────────────────────────────────────────────────────

/** In the same order `listPublishedProperties()` returns them. */
export async function publishedProperties() {
  return db().property.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      location: true,
      bhk: true,
      bhkNum: true,
      area: true,
      tagline: true,
      weeklyViewingSlots: true,
    },
  });
}

export async function propertyBySlug(slug: string) {
  const row = await db().property.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, weeklyViewingSlots: true, status: true },
  });
  if (!row) throw new Error(`no property seeded with slug "${slug}" — run npm run db:seed`);
  return row;
}

/** Live viewings in the Mon–Sun week a date falls in. Cancelled rows are excluded, as the app does. */
export async function bookedInWeek(propertyId: string, dateStr: string): Promise<number> {
  const monday = mondayOf(dateStr);
  return db().viewing.count({
    where: {
      propertyId,
      status: { not: "CANCELLED" },
      scheduledFor: {
        gte: istInstant(monday, "12:00 AM"),
        lt: istInstant(addDays(monday, 7), "12:00 AM"),
      },
    },
  });
}

export async function viewingAt(propertyId: string, dateStr: string, time: string) {
  return db().viewing.findFirst({
    where: { propertyId, scheduledFor: istInstant(dateStr, time) },
    select: { id: true, status: true, scheduledFor: true, enquiryId: true },
  });
}

export async function enquiryByReference(reference: string) {
  return db().enquiry.findUnique({
    where: { reference },
    include: { viewing: true },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Preconditions the UI cannot arrange for itself
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The first date at least `minDaysAhead` out whose IST week has no viewings at all, so a spec can
 * count slots from a known zero. Searched forward a week at a time rather than assumed, because
 * other specs book into nearby weeks and the suite must not care what order it ran in.
 */
export async function emptyWeekDate(
  propertyId: string,
  minDaysAhead: number,
  today: string,
): Promise<string> {
  for (let offset = minDaysAhead; offset < 55; offset += 1) {
    const candidate = addDays(today, offset);
    if (mondayOf(candidate) === mondayOf(today)) continue; // never the current, partly-past week
    if ((await bookedInWeek(propertyId, candidate)) === 0) return candidate;
  }
  throw new Error("no empty viewing week inside the 60-day horizon — is test data being cleaned up?");
}

/**
 * Books one specific slot straight into the database — the "someone else got there first"
 * precondition, arranged without spending the enquiry rate limit or a second browser.
 */
export async function bookSlot(
  property: { id: string; name: string },
  dateStr: string,
  time: string,
  marker: string,
): Promise<{ reference: string; scheduledFor: Date }> {
  const scheduledFor = istInstant(dateStr, time);
  const reference = `NIV-${marker.slice(-6).toUpperCase()}`;

  await db().enquiry.create({
    data: {
      reference,
      kind: "SITE_VISIT",
      status: "SCHEDULED",
      propertyId: property.id,
      propertyName: property.name,
      name: `${marker} earlier visitor`,
      phone: "+919000000001",
      viewing: { create: { propertyId: property.id, scheduledFor } },
    },
  });

  return { reference, scheduledFor };
}

/**
 * Books slots straight into the database until the week around `dateStr` is at its cap.
 * Used to reach the "fully booked" copy without spending the enquiry rate limit on it.
 */
export async function fillWeek(
  property: { id: string; name: string; weeklyViewingSlots: number },
  dateStr: string,
  marker: string,
): Promise<number> {
  const monday = mondayOf(dateStr);
  const already = await bookedInWeek(property.id, dateStr);
  const needed = property.weeklyViewingSlots - already;

  // Spread across days first, times second, so the target date keeps some of its own grid free
  // when the cap is larger than one day's worth of slots.
  const times = ["10:00 AM", "11:00 AM", "12:00 PM", "2:00 PM", "3:00 PM", "4:00 PM", "5:00 PM"];
  let placed = 0;

  outer: for (const time of times) {
    for (let day = 0; day < 7; day += 1) {
      if (placed >= needed) break outer;
      const at = istInstant(addDays(monday, day), time);
      if (at.getTime() <= Date.now()) continue;
      if (await db().viewing.findFirst({ where: { propertyId: property.id, scheduledFor: at } })) {
        continue;
      }
      await db().enquiry.create({
        data: {
          reference: `NIV-${marker.slice(0, 6).toUpperCase()}${placed}`,
          kind: "SITE_VISIT",
          status: "SCHEDULED",
          propertyId: property.id,
          propertyName: property.name,
          name: `${marker} filler`,
          phone: "+919000000000",
          viewing: { create: { propertyId: property.id, scheduledFor: at } },
        },
      });
      placed += 1;
    }
  }

  if (placed < needed) throw new Error(`could only place ${placed} of ${needed} filler viewings`);
  return placed;
}

/**
 * A viewing at an exact instant, with the enquiry that owns it.
 *
 * Unlike `bookSlot`, this takes a `Date` rather than a date/time from the picker's grid, because
 * the reminder specs care about the clock — "more than 24 hours out", "inside tomorrow in
 * Bangalore" — and not about which hours a visitor may choose. Writing straight to the database
 * is also what lets a spec arrange a CANCELLED viewing, which no public route can produce.
 */
export async function seedViewing(opts: {
  property: { id: string; name: string };
  scheduledFor: Date;
  marker: string;
  /** Distinguishes several viewings inside one test; references are unique. */
  suffix: string;
  email?: string | null;
  status?: "BOOKED" | "CANCELLED";
}): Promise<{ reference: string; enquiryId: string; viewingId: string }> {
  const status = opts.status ?? "BOOKED";
  const reference = `NIV-${opts.marker.slice(-4).toUpperCase()}${opts.suffix.toUpperCase()}`;

  const enquiry = await db().enquiry.create({
    data: {
      reference,
      kind: "SITE_VISIT",
      status: status === "CANCELLED" ? "CANCELLED" : "SCHEDULED",
      propertyId: opts.property.id,
      propertyName: opts.property.name,
      name: `${opts.marker} Visitor`,
      phone: "+919000000002",
      email: opts.email ?? null,
      viewing: {
        create: { propertyId: opts.property.id, scheduledFor: opts.scheduledFor, status },
      },
    },
    select: { id: true, viewing: { select: { id: true } } },
  });

  return { reference, enquiryId: enquiry.id, viewingId: enquiry.viewing!.id };
}

/** Whether a viewing row still exists — the question `releaseCancelledSlots()` answers. */
export async function viewingExists(viewingId: string): Promise<boolean> {
  return (await db().viewing.count({ where: { id: viewingId } })) > 0;
}

/**
 * Gives a seeded listing an owner address for the length of one test, and puts back whatever was
 * there before.
 *
 * Edits a listing that already exists rather than publishing a throwaway one, because the
 * collection specs assert the page against every PUBLISHED row — a temporary extra home would be
 * correct in the catalogue and wrong in the count some other spec is holding.
 */
export async function setOwnerEmail(
  slug: string,
  ownerEmail: string | null,
): Promise<() => Promise<void>> {
  const before = await db().property.findUnique({
    where: { slug },
    select: { ownerEmail: true },
  });
  if (!before) throw new Error(`no property seeded with slug "${slug}" — run npm run db:seed`);

  await db().property.update({ where: { slug }, data: { ownerEmail } });

  return async () => {
    await db().property.update({ where: { slug }, data: { ownerEmail: before.ownerEmail } });
  };
}

/** Every message the app decided to send about one enquiry, oldest first. */
export async function notificationsFor(enquiryId: string) {
  return db().notificationLog.findMany({
    where: { subjectId: enquiryId },
    orderBy: { createdAt: "asc" },
    select: {
      type: true,
      status: true,
      recipient: true,
      cc: true,
      subject: true,
      body: true,
      error: true,
    },
  });
}

/** A listing the public site must never show. Returns a disposer. */
export async function createUnpublishedProperty(
  marker: string,
  status: "DRAFT" | "ARCHIVED",
): Promise<{ slug: string; dispose: () => Promise<void> }> {
  const slug = `e2e-${status.toLowerCase()}-${marker.toLowerCase()}`;
  const data: Prisma.PropertyCreateInput = {
    slug,
    status,
    name: `${marker} hidden home`,
    location: "Nowhere, Bangalore",
    locality: "Nowhere",
    tagline: "Should never reach a browser.",
    story: "Should never reach a browser.",
    description: ["Should never reach a browser."],
    bhk: "3 BHK",
    bhkNum: 3,
    areaLabel: "Carpet Area",
    area: "1,000 sqft",
    areaSqft: 1000,
    pricePaise: BigInt(1_000_000_000),
    latitude: 12.9,
    longitude: 77.6,
    amenities: ["LIFT"],
    hoodBlurb: "",
    heroImageUrl: "https://example.invalid/hero.jpg",
  };

  await db().property.create({ data });
  return {
    slug,
    dispose: async () => {
      await db().property.deleteMany({ where: { slug } });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

/** Every row a spec writes carries this, so cleanup never has to guess. */
export const E2E_MARKER = "PWE2E";

export function markerFor(token: string): string {
  return `${E2E_MARKER}-${token}`;
}

/**
 * Deletes everything one test wrote. `Viewing` is `onDelete: Cascade` from `Enquiry`, so the
 * booked slots go with the enquiries and the week's count returns to what it was.
 */
export async function purgeMarker(marker: string): Promise<void> {
  const prisma = db();
  // Threads first: `EmailMessage` and `AgentDraft` both cascade from `EmailThread`, and an
  // enquiry deleted before its thread leaves the thread behind with a null `enquiryId`.
  await prisma.emailThread.deleteMany({
    where: { participantEmail: { contains: marker.toLowerCase() } },
  });
  await prisma.enquiry.deleteMany({ where: { name: { contains: marker } } });
  await prisma.ownerSubmission.deleteMany({ where: { name: { contains: marker } } });
  await prisma.subscriber.deleteMany({ where: { email: { contains: marker.toLowerCase() } } });
  await prisma.notificationLog.deleteMany({ where: { body: { contains: marker } } });
  await prisma.property.deleteMany({ where: { slug: { contains: marker.toLowerCase() } } });
}

/** The whole suite's leftovers, for global teardown and for recovering from a killed run. */
export async function purgeAllE2EData(): Promise<void> {
  const prisma = db();
  await prisma.emailThread.deleteMany({
    where: { participantEmail: { contains: E2E_MARKER.toLowerCase() } },
  });
  await prisma.enquiry.deleteMany({ where: { name: { contains: E2E_MARKER } } });
  await prisma.ownerSubmission.deleteMany({ where: { name: { contains: E2E_MARKER } } });
  await prisma.subscriber.deleteMany({ where: { email: { contains: E2E_MARKER.toLowerCase() } } });
  await prisma.notificationLog.deleteMany({ where: { body: { contains: E2E_MARKER } } });
  await prisma.property.deleteMany({ where: { slug: { contains: E2E_MARKER.toLowerCase() } } });
}
