import type { Amenity, HoodKind } from "@prisma/client";

/**
 * What crosses the boundary into the client bundle. Nothing here is a Prisma row: a DTO is
 * chosen field by field, so adding a column to the schema never silently ships it to a
 * browser, and every `Date` is already an ISO string.
 */

export interface AvailabilityDto {
  /** Slots left in the current Mon–Sun week, in Asia/Kolkata. */
  slotsLeft: number;
  /** How many the owner honours per week — the denominator behind the badge. */
  weeklySlots: number;
  /** "3 viewing slots left" */
  label: string;
  /** "Only 3 viewing slots left this week" */
  line: string;
  /** Warm amber at two or fewer, otherwise green. */
  dot: string;
}

export interface HoodPlaceDto {
  kind: HoodKind;
  name: string;
  distance: string;
}

export interface GalleryImageDto {
  url: string;
  alt: string;
}

export interface PropertyDto {
  id: string;
  slug: string;
  name: string;
  location: string;
  locality: string;
  tagline: string;
  story: string;
  description: string[];
  bhk: string;
  bhkNum: number;
  areaLabel: string;
  area: string;
  areaSqft: number;
  pricePaise: number;
  latitude: number;
  longitude: number;
  amenities: Amenity[];
  hoodBlurb: string;
  hood: HoodPlaceDto[];
  heroImageUrl: string;
  images: GalleryImageDto[];
  videoUrl: string | null;
  floorplanUrl: string | null;
  floorplanNote: string | null;
  availability: AvailabilityDto;
}

/** What `GET /api/properties/[slug]/availability` answers for one date. */
export interface DayAvailabilityDto {
  date: string;
  slots: { time: string; available: boolean }[];
  /** Slots left in the week that date falls in — not necessarily the current week. */
  slotsLeftInWeek: number;
  weeklySlots: number;
}

export interface EnquiryReceiptDto {
  reference: string;
  kind: string;
  propertyName: string | null;
  /** Present only when a slot was booked. */
  scheduledFor: string | null;
  whenLine: string | null;
}
