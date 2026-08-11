import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Shared request schemas. One definition per shape, used by the route handler and by the form
 * that posts to it, so client and server cannot disagree about what is valid.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "The URL must be at least 3 characters")
  .max(80, "The URL must be at most 80 characters")
  .regex(SLUG_PATTERN, "Use lowercase letters, numbers and single hyphens");

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * E.164 for India. Accepts the four shapes a person actually types — `9876543210`,
 * `+91 98765 43210`, `919876543210`, `09876543210` — and stores exactly one.
 *
 * Normalising on the way in rather than at read time is what makes `Enquiry.phone` a usable
 * index: the same person enquiring twice must collide, and four spellings of one number do not.
 */
export function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const bare = digits.startsWith("+") ? digits.slice(1) : digits;

  if (/^[6-9]\d{9}$/.test(bare)) return `+91${bare}`;
  if (/^91[6-9]\d{9}$/.test(bare)) return `+${bare}`;
  if (/^0[6-9]\d{9}$/.test(bare)) return `+91${bare.slice(1)}`;
  // Any other country: accept a plausible E.164 rather than refusing an NRI buyer.
  if (digits.startsWith("+") && /^\+\d{8,15}$/.test(digits)) return digits;
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .min(1, "Add a phone number")
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "That phone number does not look right" });
      return z.NEVER;
    }
    return normalized;
  });

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Add your name")
  .max(120, "That name is too long");

export const emailSchema = z.email("That email address does not look right").max(200);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** `YYYY-MM-DD`, as an `<input type="date">` produces it. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((value) => {
    const [y, m, d] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return (
      probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
    );
  }, "That is not a real date");

/** Turns a ZodError into the one sentence a form can display. */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Check the details and try again";
}

/**
 * A short handle a person can read down a phone line. Crockford-ish alphabet: no I, L, O or U,
 * so "NIV-1O0" cannot be misheard as "NIV-10O". 6 chars over a 30-symbol alphabet is ~729M
 * combinations, and the column is unique, so a collision is a retry rather than a silent merge.
 */
const REFERENCE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function makeReference(prefix = "NIV"): string {
  const bytes = randomBytes(6);
  let out = "";
  for (const byte of bytes) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return `${prefix}-${out}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: enquiries
// ─────────────────────────────────────────────────────────────────────────────

export const enquiryKindSchema = z.enum(["SITE_VISIT", "OWNER_CALL", "MESSAGE", "GENERAL"]);

export const enquiryCreateSchema = z
  .object({
    kind: enquiryKindSchema,
    /** Absent for GENERAL. Never an id — the client only knows slugs. */
    propertySlug: z.string().trim().max(80).optional().nullable(),
    name: nameSchema,
    phone: phoneSchema,
    email: emailSchema.optional().nullable(),
    message: optionalText(2000),
    date: isoDateSchema.optional().nullable(),
    /** "10:00 AM" — validated against the property's real slot grid, not just the shape. */
    time: z.string().trim().max(12).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const needsSlot = value.kind === "SITE_VISIT" || value.kind === "OWNER_CALL";
    if (needsSlot && (!value.date || !value.time)) {
      ctx.addIssue({ code: "custom", message: "Pick a date and time", path: ["time"] });
    }
    if (value.kind !== "GENERAL" && !value.propertySlug) {
      ctx.addIssue({ code: "custom", message: "That home is no longer listed", path: ["propertySlug"] });
    }
  });

export type EnquiryCreateInput = z.infer<typeof enquiryCreateSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Public: owner submissions and newsletter
// ─────────────────────────────────────────────────────────────────────────────

export const ownerSubmissionCreateSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema.optional().nullable(),
  locality: z.string().trim().min(2, "Add the locality").max(120),
  propertyType: optionalText(60),
  config: optionalText(30),
  areaSqft: z.coerce.number().int().min(0).max(1_000_000).optional().nullable(),
  expectedPrice: optionalText(60),
  timeline: optionalText(60),
  message: optionalText(2000),
  mediaCount: z.coerce.number().int().min(0).max(100).default(0),
});

export const subscriberCreateSchema = z.object({ email: emailSchema });

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

export const amenitySchema = z.enum([
  "GYM",
  "SECURITY",
  "LIFT",
  "PARKING",
  "POWER",
  "GARDEN",
  "POOL",
  "STUDY",
]);

export const hoodKindSchema = z.enum([
  "TRANSIT",
  "WORK",
  "SCHOOL",
  "HEALTH",
  "SHOPPING",
  "DINING",
  "PARK",
]);

export const propertyStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);

export const propertyImageSchema = z.object({
  url: z.url("Each gallery image needs a URL"),
  alt: z.string().trim().min(1, "Describe the image").max(200),
});

export const hoodPlaceSchema = z.object({
  kind: hoodKindSchema,
  name: z.string().trim().min(1).max(120),
  distance: z.string().trim().min(1).max(40),
});

export const propertyCreateSchema = z.object({
  images: z.array(propertyImageSchema).max(24).default([]),
  hood: z.array(hoodPlaceSchema).max(24).default([]),
  slug: slugSchema.optional(),
  name: z.string().trim().min(2).max(160),
  location: z.string().trim().min(2).max(160),
  locality: z.string().trim().min(2).max(80),
  tagline: z.string().trim().min(2).max(300),
  story: z.string().trim().min(2).max(4000),
  description: z.array(z.string().trim().min(1).max(4000)).max(12).default([]),
  bhk: z.string().trim().min(1).max(20),
  bhkNum: z.coerce.number().int().min(0).max(20),
  areaLabel: z.string().trim().min(2).max(40),
  area: z.string().trim().min(1).max(40),
  areaSqft: z.coerce.number().int().min(0).max(1_000_000),
  /** Paise. A float here is a bug, not a rounding preference. Stored as INT8 — see schema. */
  pricePaise: z.coerce.number().int().min(0).max(1_000_000_000_000_000),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  amenities: z.array(amenitySchema).max(20).default([]),
  hoodBlurb: z.string().trim().max(2000).default(""),
  heroImageUrl: z.url("The hero image must be a URL"),
  videoUrl: z.union([z.url(), z.literal("")]).optional().nullable(),
  floorplanUrl: z.union([z.url(), z.literal("")]).optional().nullable(),
  floorplanNote: optionalText(300),
  weeklyViewingSlots: z.coerce.number().int().min(0).max(50).default(3),
  /** CC'd on enquiries about this home. Empty string clears it, matching videoUrl/floorplanUrl. */
  ownerEmail: z.union([emailSchema, z.literal("")]).optional().nullable(),
});

export const propertyUpdateSchema = propertyCreateSchema.partial().extend({
  status: propertyStatusSchema.optional(),
});

export const enquiryUpdateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "SCHEDULED", "CLOSED", "CANCELLED"]).optional(),
  notes: optionalText(4000),
});

export const submissionUpdateSchema = z.object({
  status: z.enum(["NEW", "REVIEWING", "ACCEPTED", "DECLINED"]).optional(),
  notes: optionalText(4000),
});

/**
 * What a curator may do to a drafted reply.
 *
 * `body` and `subject` are optional overrides: approving a draft after editing it is the same
 * action as approving it untouched, and forcing the client to re-post the unedited text would
 * turn every "looks fine, send it" into a chance to send something subtly different.
 */
export const agentDraftActionSchema = z.object({
  action: z.enum(["send", "dismiss"]),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(1).max(8000).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The AgentMail `message.received` payload, in its wire spelling.
 *
 * Only the fields we store are declared — Zod strips the rest, which is the same field-by-field
 * discipline `lib/dto.ts` applies on the way out. `message` is optional because the endpoint is
 * subscribed to more than one event type and a `domain.verified` carries no message at all.
 */
export const agentMailEventSchema = z.object({
  event_type: z.string().trim().min(1).max(80),
  event_id: z.string().trim().max(200).optional(),
  message: z
    .object({
      inbox_id: z.string().trim().min(1).max(200),
      thread_id: z.string().trim().min(1).max(200),
      message_id: z.string().trim().min(1).max(500),
      from: z.string().trim().min(1).max(320),
      to: z.array(z.string().trim().max(320)).max(50).default([]),
      subject: z.string().max(500).optional().nullable(),
      text: z.string().max(200_000).optional().nullable(),
      /** New content with quoted history stripped. Preferred over `text` — see lib/email-threads.ts. */
      extracted_text: z.string().max(200_000).optional().nullable(),
      /**
       * Both HTML fields are carried purely as a fallback. Gmail and Outlook send forwarded mail
       * HTML-only, with no `text/plain` part at all — so `text` and `extracted_text` are simply
       * absent on exactly the messages a person is most likely to forward us.
       */
      html: z.string().max(400_000).optional().nullable(),
      extracted_html: z.string().max(400_000).optional().nullable(),
      timestamp: z.string().trim().max(60).optional().nullable(),
      labels: z.array(z.string().trim().max(80)).max(50).default([]),
    })
    .optional(),
});

export type AgentMailEvent = z.infer<typeof agentMailEventSchema>;

export const listQuerySchema = z.object({
  status: z.string().trim().max(20).optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
