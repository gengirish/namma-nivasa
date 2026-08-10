import type { Amenity, HoodKind } from "@prisma/client";

/** Inline SVG → data URI, so a placeholder never needs the network. */
export function svgUri(svg: string): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shown when a listing photograph fails to load.
 *
 * Generated from the listing's own name rather than looked up by id: photography is uploaded
 * per property now, so an id-keyed map of hand-drawn fallbacks would cover the three homes that
 * happened to be seeded and leave every home added afterwards with a blank rectangle.
 */
export function propertyPlaceholder(name: string): string {
  const label = escapeXml(name.toUpperCase()).slice(0, 42);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#1C1917"/><rect x="0" y="620" width="1200" height="180" fill="#141210"/><rect x="430" y="230" width="340" height="400" fill="none" stroke="#A16207" stroke-width="2"/><g stroke="#A16207" stroke-width="1" opacity="0.7"><line x1="430" y1="330" x2="770" y2="330"/><line x1="430" y1="430" x2="770" y2="430"/><line x1="430" y1="530" x2="770" y2="530"/><line x1="550" y1="230" x2="550" y2="630"/><line x1="670" y1="230" x2="670" y2="630"/></g><text x="600" y="740" font-family="Georgia,serif" font-size="26" letter-spacing="6" fill="#A16207" text-anchor="middle" opacity="0.8">${label}</text></svg>`;
}

/** The same idea for a gallery image, captioned with its alt text. */
export function imagePlaceholder(alt: string): string {
  const label = escapeXml(alt.toUpperCase()).slice(0, 28);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#1C1917"/><rect x="60" y="150" width="200" height="70" rx="8" fill="none" stroke="#A16207" stroke-width="2"/><rect x="30" y="40" width="120" height="80" fill="none" stroke="#A16207" stroke-width="2"/><text x="200" y="270" font-family="Georgia,serif" font-size="14" letter-spacing="4" fill="#A16207" text-anchor="middle" opacity="0.8">${label}</text></svg>`;
}

/** Stands in until an architect's drawing is uploaded. */
export const FLOORPLAN_PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300"><rect x="1" y="1" width="598" height="298" fill="#FAF7F2" stroke="#DDD5C9"/><rect x="40" y="40" width="240" height="130" fill="none" stroke="#1C1917" stroke-width="2"/><rect x="300" y="40" width="260" height="130" fill="none" stroke="#1C1917" stroke-width="2"/><rect x="40" y="190" width="520" height="70" fill="none" stroke="#A16207" stroke-width="1.5" stroke-dasharray="6,4"/><text x="300" y="232" font-family="Georgia,serif" font-size="15" letter-spacing="4" fill="#A16207" text-anchor="middle">FLOOR PLAN NOT YET UPLOADED</text></svg>`;

export const AMENITY_ICON: Record<Amenity, string> = {
  GYM: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M4 8v8M20 8v8M2 10v4M22 10v4M7 12h10"/></svg>`,
  SECURITY: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z"/></svg>`,
  LIFT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><rect x="6" y="3" width="12" height="18" rx="1"/><path d="M12 8l-2 2h4zM12 16l2-2h-4z"/></svg>`,
  PARKING: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 16V8h4a2.5 2.5 0 010 5H9"/></svg>`,
  POWER: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>`,
  GARDEN: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M12 21c0-6-4-8-4-13a4 4 0 018 0c0 5-4 7-4 13z"/></svg>`,
  POOL: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M2 17c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0M2 12c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0"/></svg>`,
  STUDY: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M4 19V5a2 2 0 012-2h5v18H6a2 2 0 01-2-2z"/><path d="M11 3h7a2 2 0 012 2v14a2 2 0 01-2 2h-7"/></svg>`,
};

export const HOOD_ICON: Record<HoodKind, string> = {
  TRANSIT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 11h14M8 20l-1.5 1.5M16 20l1.5 1.5"/><circle cx="8.5" cy="13.5" r="0.6" fill="#A16207"/><circle cx="15.5" cy="13.5" r="0.6" fill="#A16207"/></svg>`,
  WORK: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/></svg>`,
  SCHOOL: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M12 4L2 9l10 5 10-5-10-5z"/><path d="M6 11v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5"/></svg>`,
  HEALTH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 8v8M8 12h8"/></svg>`,
  SHOPPING: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>`,
  DINING: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M6 3v7a2 2 0 004 0V3M8 10v11M16 3c-1.5 0-2.5 2-2.5 5S15 13 16 13v8"/></svg>`,
  PARK: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#A16207" stroke-width="1.6"><path d="M12 22v-6M8 16a4 4 0 01-1-8 5 5 0 0110 0 4 4 0 01-1 8H8z"/></svg>`,
};

/** Map pin, rendered into a Leaflet divIcon. */
export const MAP_PIN = `<svg width="32" height="40" viewBox="0 0 32 40" xmlns="http://www.w3.org/2000/svg"><path d="M16 0C7.7 0 1 6.7 1 15c0 10.5 15 25 15 25s15-14.5 15-25C31 6.7 24.3 0 16 0z" fill="#A16207" stroke="#fff" stroke-width="2"/><circle cx="16" cy="15" r="5.5" fill="#fff"/></svg>`;
