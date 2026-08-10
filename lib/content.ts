import type { Amenity, HoodKind } from "@prisma/client";

/**
 * Marketing copy and label maps. Exported constants rather than strings inlined in components,
 * so the words a curator wants to change are all in one file.
 *
 * Listings are NOT here — they live in the database. Anything in this file is true of the brand,
 * not of a particular home.
 */

export const AMENITY_LABEL: Record<Amenity, string> = {
  GYM: "Gym",
  SECURITY: "24/7 Security",
  LIFT: "Elevator",
  PARKING: "Covered Parking",
  POWER: "Power Backup",
  GARDEN: "Landscaped Garden",
  POOL: "Swimming Pool",
  STUDY: "Study Room",
};

export const HOOD_LABEL: Record<HoodKind, string> = {
  TRANSIT: "Transit",
  WORK: "Workplace",
  SCHOOL: "School",
  HEALTH: "Healthcare",
  SHOPPING: "Shopping",
  DINING: "Dining",
  PARK: "Green space",
};

export interface Faq {
  q: string;
  a: string;
}

export const FAQS: Faq[] = [
  {
    q: "Why are there only a few listings at a time?",
    a: "Every home on Nivasa is personally visited, verified and photographed before it is published — that curation is deliberately slow, by design.",
  },
  {
    q: "Is there any brokerage fee?",
    a: "No. Nivasa connects you directly with the property owner — there is no brokerage or middleman fee on either side.",
  },
  {
    q: "How do I schedule a visit?",
    a: 'Use "Schedule a Site Visit" on any listing, pick a date and time, and the owner will confirm directly with you. The times you see are the ones still open — a slot someone else has booked will not be offered.',
  },
  {
    q: "Are the listings RERA registered?",
    a: "Yes, in principle — each project's RERA registration number appears on its detail page once added by the owner (placeholder in this MVP).",
  },
  {
    q: "Can I list my own property on Nivasa?",
    a: "Yes — tell us about your home through the owner intake (“List your home”) and our team reviews it personally. We stay invite-quality, so submitting doesn’t guarantee a listing, but every home is considered.",
  },
];

export const TESTIMONIALS = [
  {
    quote: "Every detail on the listing matched the actual home — no surprises during the visit.",
    who: "Ananya R.",
  },
  {
    quote: "Spoke to the owner directly within the hour. No broker back-and-forth at all.",
    who: "Karthik S.",
  },
  {
    quote: "So few listings, but every one felt genuinely worth seeing. It made the search calm.",
    who: "Meera D.",
  },
];

export const STEPS = [
  {
    n: "01",
    title: "We visit, in person",
    body: "No listing goes live unseen. We walk every home, meet the owner, and check the paperwork ourselves.",
  },
  {
    n: "02",
    title: "We tell its story",
    body: "Photographs, floor plans and an honest account of who each home is really for — so you know before you visit.",
  },
  {
    n: "03",
    title: "You talk to the owner",
    body: "Book a visit and we connect you directly with the owner. No brokerage, no relay, no pressure.",
  },
];

export const OWNER_REASONS = [
  {
    title: "Zero brokerage",
    body: "Buyers reach you directly. We never take a cut from either side.",
  },
  {
    title: "We tell its story",
    body: "Professional photography, floor plans and honest copy — so serious buyers arrive already informed.",
  },
  {
    title: "A curated audience",
    body: "Your home sits among a small, deliberate collection — not lost in an endless feed.",
  },
];
