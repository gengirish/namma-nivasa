import { prisma } from "@/lib/prisma";
import {
  SLOT_TIMES,
  isBookableDate,
  slotInstant,
  weekOf,
  type WeekWindow,
} from "@/lib/slots";
import type { AvailabilityDto, DayAvailabilityDto } from "@/lib/dto";

/**
 * Viewing availability — the honest version of the design's scarcity badge.
 *
 * The prototype's "3 viewing slots left" was a static number in a data file. Here it is
 * `weeklyViewingSlots` minus the viewings actually on the books for that week, so it goes down
 * when someone books and comes back when a week rolls over.
 *
 * There is no counter column and no lock. `Viewing` carries a unique index on
 * `(propertyId, scheduledFor)`, so two people choosing the same slot race to INSERT and
 * Postgres refuses the loser — see `bookViewing` in lib/enquiries.ts. The week cap is checked
 * with a count, which *can* be raced past by one under heavy concurrency; that is a deliberate
 * trade. Overshooting a soft weekly target by one costs an owner a phone call, whereas the
 * double-booking the unique index prevents costs two people arriving at the same door.
 */

const AMBER = "#C2410C";
const GREEN = "#15803D";

/** Counts the slots already taken in one week for one property. */
async function bookedInWeek(propertyId: string, week: WeekWindow): Promise<number> {
  return prisma.viewing.count({
    where: {
      propertyId,
      status: { not: "CANCELLED" },
      scheduledFor: { gte: week.start, lt: week.end },
    },
  });
}

/** Same, for many properties at once — the listing grid must not fan out per card. */
async function bookedInWeekByProperty(
  propertyIds: string[],
  week: WeekWindow,
): Promise<Map<string, number>> {
  if (propertyIds.length === 0) return new Map();
  const rows = await prisma.viewing.groupBy({
    by: ["propertyId"],
    where: {
      propertyId: { in: propertyIds },
      status: { not: "CANCELLED" },
      scheduledFor: { gte: week.start, lt: week.end },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.propertyId, r._count._all]));
}

export function describeAvailability(slotsLeft: number, weeklySlots: number): AvailabilityDto {
  const n = Math.max(0, slotsLeft);
  const plural = n === 1 ? "" : "s";
  return {
    slotsLeft: n,
    weeklySlots,
    label: n === 0 ? "Fully booked this week" : `${n} viewing slot${plural} left`,
    line:
      n === 0
        ? "Fully booked this week — ask us about next week"
        : `Only ${n} viewing slot${plural} left this week`,
    dot: n <= 2 ? AMBER : GREEN,
  };
}

export async function availabilityFor(
  property: { id: string; weeklyViewingSlots: number },
  now: Date = new Date(),
): Promise<AvailabilityDto> {
  const booked = await bookedInWeek(property.id, weekOf(now));
  return describeAvailability(property.weeklyViewingSlots - booked, property.weeklyViewingSlots);
}

export async function availabilityForMany(
  properties: { id: string; weeklyViewingSlots: number }[],
  now: Date = new Date(),
): Promise<Map<string, AvailabilityDto>> {
  const counts = await bookedInWeekByProperty(
    properties.map((p) => p.id),
    weekOf(now),
  );
  return new Map(
    properties.map((p) => [
      p.id,
      describeAvailability(p.weeklyViewingSlots - (counts.get(p.id) ?? 0), p.weeklyViewingSlots),
    ]),
  );
}

/**
 * Which times on one date are still open. Past slots on today's date are closed too — offering
 * a 10 AM visit at 4 PM is a booking the owner will not honour.
 */
export async function dayAvailability(
  property: { id: string; weeklyViewingSlots: number },
  dateStr: string,
  now: Date = new Date(),
): Promise<DayAvailabilityDto> {
  const week = weekOf(slotInstant(dateStr, "12:00 PM") ?? now);
  const dayStart = slotInstant(dateStr, "12:00 AM");
  const dayEnd = dayStart ? new Date(dayStart.getTime() + 24 * 60 * 60_000) : null;

  const [taken, bookedThisWeek] = await Promise.all([
    dayStart && dayEnd
      ? prisma.viewing.findMany({
          where: {
            propertyId: property.id,
            status: { not: "CANCELLED" },
            scheduledFor: { gte: dayStart, lt: dayEnd },
          },
          select: { scheduledFor: true },
        })
      : Promise.resolve([]),
    bookedInWeek(property.id, week),
  ]);

  const takenAt = new Set(taken.map((v) => v.scheduledFor.getTime()));
  const slotsLeftInWeek = Math.max(0, property.weeklyViewingSlots - bookedThisWeek);
  const dateIsBookable = isBookableDate(dateStr, now);

  return {
    date: dateStr,
    weeklySlots: property.weeklyViewingSlots,
    slotsLeftInWeek,
    slots: SLOT_TIMES.map((time) => {
      const at = slotInstant(dateStr, time);
      const open =
        dateIsBookable &&
        slotsLeftInWeek > 0 &&
        at !== null &&
        at.getTime() > now.getTime() &&
        !takenAt.has(at.getTime());
      return { time, available: open };
    }),
  };
}

/** Whether a week still has room. Checked at booking time against the *target* week. */
export async function weekHasRoom(
  property: { id: string; weeklyViewingSlots: number },
  at: Date,
): Promise<boolean> {
  const booked = await bookedInWeek(property.id, weekOf(at));
  return booked < property.weeklyViewingSlots;
}
