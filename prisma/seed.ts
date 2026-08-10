import { PrismaClient, type Amenity, type HoodKind } from "@prisma/client";

/**
 * The three homes the design was written against, as real rows.
 *
 * Idempotent: every listing is upserted by slug and its child collections are replaced, so
 * running this twice leaves the same catalogue rather than a duplicated one. Enquiries and
 * viewings are never touched — a reseed must not delete a lead somebody left.
 *
 * Photography is from Pexels and stands in until the owner's own shoot is uploaded; the floor
 * plans are illustrative SVGs carried as data URIs, which is exactly what `floorplanUrl`
 * documents as a legitimate value.
 */

const prisma = new PrismaClient();

function svgUri(svg: string): string {
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const INTERIOR = {
  living:
    "https://images.pexels.com/photos/5570222/pexels-photo-5570222.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1",
  bedroom:
    "https://images.pexels.com/photos/8251914/pexels-photo-8251914.jpeg?auto=compress&w=1260&h=750&dpr=1",
  bath: "https://images.pexels.com/photos/11701114/pexels-photo-11701114.jpeg?auto=compress&w=1260&h=750&dpr=1",
};

const SAMPLE_VIDEO =
  "https://videos.pexels.com/video-files/7578552/7578552-uhd_2560_1440_30fps.mp4";

const FLOORPLANS: Record<string, string> = {
  "aurelia-residency": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect x="1" y="1" width="598" height="398" fill="#FAF7F2" stroke="#DDD5C9"/><rect x="20" y="20" width="360" height="190" fill="none" stroke="#1C1917" stroke-width="2"/><text x="200" y="120" font-family="Georgia,serif" font-size="16" fill="#44403C" text-anchor="middle">LIVING &amp; DINING</text><rect x="380" y="20" width="200" height="190" fill="none" stroke="#1C1917" stroke-width="2"/><text x="480" y="120" font-family="Georgia,serif" font-size="14" fill="#44403C" text-anchor="middle">KITCHEN</text><rect x="20" y="210" width="220" height="170" fill="none" stroke="#1C1917" stroke-width="2"/><text x="130" y="300" font-family="Georgia,serif" font-size="14" fill="#44403C" text-anchor="middle">MASTER BEDROOM</text><rect x="240" y="210" width="90" height="170" fill="none" stroke="#1C1917" stroke-width="1.5"/><text x="285" y="300" font-family="Georgia,serif" font-size="11" fill="#8a8580" text-anchor="middle">BATH</text><rect x="330" y="210" width="140" height="170" fill="none" stroke="#1C1917" stroke-width="2"/><text x="400" y="300" font-family="Georgia,serif" font-size="13" fill="#44403C" text-anchor="middle">BEDROOM 2</text><rect x="470" y="210" width="110" height="110" fill="none" stroke="#1C1917" stroke-width="2"/><text x="525" y="270" font-family="Georgia,serif" font-size="12" fill="#44403C" text-anchor="middle">BEDROOM 3</text><rect x="470" y="320" width="110" height="60" fill="none" stroke="#1C1917" stroke-width="1.5"/><text x="525" y="355" font-family="Georgia,serif" font-size="11" fill="#8a8580" text-anchor="middle">BATH</text><circle cx="20" cy="115" r="4" fill="#A16207"/></svg>`,
  "emerald-heights-villa": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect x="1" y="1" width="598" height="398" fill="#FAF7F2" stroke="#DDD5C9"/><rect x="20" y="20" width="280" height="200" fill="none" stroke="#1C1917" stroke-width="2"/><text x="160" y="125" font-family="Georgia,serif" font-size="16" fill="#44403C" text-anchor="middle">LIVING &amp; DINING</text><rect x="300" y="20" width="150" height="120" fill="none" stroke="#1C1917" stroke-width="2"/><text x="375" y="85" font-family="Georgia,serif" font-size="13" fill="#44403C" text-anchor="middle">KITCHEN</text><rect x="300" y="140" width="150" height="80" fill="none" stroke="#1C1917" stroke-width="1.5"/><text x="375" y="185" font-family="Georgia,serif" font-size="12" fill="#44403C" text-anchor="middle">STUDY</text><rect x="460" y="20" width="120" height="90" fill="none" stroke="#1C1917" stroke-width="1.5"/><text x="520" y="70" font-family="Georgia,serif" font-size="11" fill="#8a8580" text-anchor="middle">POWDER</text><rect x="20" y="240" width="560" height="140" fill="none" stroke="#A16207" stroke-width="1.5" stroke-dasharray="6,4"/><text x="300" y="315" font-family="Georgia,serif" font-size="14" fill="#A16207" text-anchor="middle">GARDEN &amp; PLUNGE POOL</text><circle cx="20" cy="120" r="4" fill="#A16207"/></svg>`,
  "the-meridian-sky-suites": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><rect x="1" y="1" width="598" height="398" fill="#FAF7F2" stroke="#DDD5C9"/><rect x="20" y="20" width="300" height="200" fill="none" stroke="#1C1917" stroke-width="2"/><text x="170" y="125" font-family="Georgia,serif" font-size="15" fill="#44403C" text-anchor="middle">LIVING &amp; DINING</text><rect x="320" y="20" width="130" height="100" fill="none" stroke="#1C1917" stroke-width="2"/><text x="385" y="75" font-family="Georgia,serif" font-size="12" fill="#44403C" text-anchor="middle">KITCHEN</text><rect x="320" y="120" width="130" height="100" fill="none" stroke="#1C1917" stroke-width="1.5"/><text x="385" y="175" font-family="Georgia,serif" font-size="11" fill="#44403C" text-anchor="middle">STUDY NOOK</text><rect x="460" y="20" width="120" height="200" fill="none" stroke="#A16207" stroke-width="1.5" stroke-dasharray="6,4"/><text x="520" y="125" font-family="Georgia,serif" font-size="12" fill="#A16207" text-anchor="middle">BALCONY</text><rect x="20" y="240" width="260" height="140" fill="none" stroke="#1C1917" stroke-width="2"/><text x="150" y="315" font-family="Georgia,serif" font-size="13" fill="#44403C" text-anchor="middle">MASTER BEDROOM</text><rect x="280" y="240" width="200" height="140" fill="none" stroke="#1C1917" stroke-width="2"/><text x="380" y="315" font-family="Georgia,serif" font-size="13" fill="#44403C" text-anchor="middle">BEDROOM 2</text><rect x="480" y="240" width="100" height="140" fill="none" stroke="#1C1917" stroke-width="1.5"/><text x="530" y="315" font-family="Georgia,serif" font-size="11" fill="#8a8580" text-anchor="middle">BATH</text><circle cx="20" cy="120" r="4" fill="#A16207"/></svg>`,
};

interface SeedProperty {
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
  pricePaise: bigint;
  latitude: number;
  longitude: number;
  amenities: Amenity[];
  weeklyViewingSlots: number;
  hoodBlurb: string;
  hood: [HoodKind, string, string][];
  heroImageUrl: string;
  floorplanNote: string;
}

const PROPERTIES: SeedProperty[] = [
  {
    slug: "aurelia-residency",
    name: "Aurelia Residency",
    location: "Whitefield, Bangalore",
    locality: "Whitefield",
    tagline: "For the professional who wants the city close, but never loud.",
    story:
      "Wake to unhurried morning light through floor-to-ceiling glass, fourteen floors above the tech corridor. A landscaped courtyard sits below and a quiet balcony off the primary bedroom is yours alone — ITPL ten minutes away, its noise never inside.",
    description: [
      "Aurelia Residency occupies the fourteenth floor of a low-density tower in Whitefield, minutes from the ITPL tech park. The living room catches the morning light and a private balcony overlooks a landscaped courtyard.",
      "The building includes a resident-only gym, a rooftop deck and round-the-clock security. This is an individually verified listing — never part of an automated feed.",
    ],
    bhk: "3 BHK",
    bhkNum: 3,
    areaLabel: "Carpet Area",
    area: "1,650 sqft",
    areaSqft: 1650,
    pricePaise: BigInt(1_350_000_000), // ₹1.35 Cr
    latitude: 12.9698,
    longitude: 77.75,
    amenities: ["GYM", "SECURITY", "LIFT", "PARKING", "POWER", "GARDEN"],
    weeklyViewingSlots: 3,
    hoodBlurb:
      "Whitefield has grown from a quiet cantonment into Bangalore's eastern tech heart — leafy avenues, international schools and weekend markets sit minutes from the ITPL corridor.",
    hood: [
      ["TRANSIT", "Whitefield (Kadugodi) Metro", "10 min walk"],
      ["WORK", "ITPL Tech Park", "8 min drive"],
      ["SHOPPING", "Phoenix Marketcity", "12 min drive"],
      ["SCHOOL", "Vydehi School of Excellence", "9 min drive"],
      ["HEALTH", "Manipal Hospital Whitefield", "7 min drive"],
      ["DINING", "Windmills Craftworks", "11 min drive"],
      ["PARK", "Nallurhalli Lake", "6 min drive"],
    ],
    heroImageUrl:
      "https://images.pexels.com/photos/33619255/pexels-photo-33619255/free-photo-of-modern-high-rise-apartment-building-exterior.png?auto=compress&w=1260&h=750&dpr=1",
    floorplanNote: "Illustrative floor plan — not to scale.",
  },
  {
    slug: "emerald-heights-villa",
    name: "Emerald Heights Villa",
    location: "Sarjapur Road, Bangalore",
    locality: "Sarjapur Road",
    tagline: "For the family ready to stop sharing walls.",
    story:
      "There are homes, and then there is land to call your own. A private lawn, a plunge pool that holds the evening sun, and rooms that breathe — behind gated walls off Sarjapur Road. The rare Bangalore home where children run barefoot and mornings begin outdoors.",
    description: [
      "Emerald Heights Villa is a standalone home within a gated community off Sarjapur Road, close to major tech parks and international schools. The ground floor opens onto a private lawn and plunge pool; upstairs holds three bedrooms and a study overlooking the garden.",
      "A two-car garage, solar water heating and a backup generator are already in place. This listing was personally verified and photographed by the Nivasa team.",
    ],
    bhk: "4 BHK",
    bhkNum: 4,
    areaLabel: "Plot Area",
    area: "2,800 sqft",
    areaSqft: 2800,
    pricePaise: BigInt(2_900_000_000), // ₹2.90 Cr
    latitude: 12.901,
    longitude: 77.687,
    amenities: ["POOL", "GARDEN", "PARKING", "POWER", "SECURITY", "STUDY"],
    weeklyViewingSlots: 2,
    hoodBlurb:
      "Sarjapur Road threads together gated communities, marquee tech campuses and some of the city's best international schools — green, low-rise and unmistakably family-first.",
    hood: [
      ["WORK", "Wipro Corporate Office", "10 min drive"],
      ["SCHOOL", "DPS International", "6 min drive"],
      ["HEALTH", "Columbia Asia Hospital", "12 min drive"],
      ["SHOPPING", "Market Square Mall", "9 min drive"],
      ["DINING", "The Bier Library", "14 min drive"],
      ["PARK", "Sarjapur Lake", "15 min walk"],
      ["TRANSIT", "Carmelaram Rail Station", "12 min drive"],
    ],
    heroImageUrl:
      "https://images.pexels.com/photos/29453302/pexels-photo-29453302/free-photo-of-modern-luxury-villa-with-pool-in-sunlit-garden.jpeg?w=1260&h=750&dpr=1",
    floorplanNote:
      "Ground floor shown — the 4 bedrooms sit on the first floor above. Illustrative only, not to scale.",
  },
  {
    slug: "the-meridian-sky-suites",
    name: "The Meridian Sky Suites",
    location: "Indiranagar, Bangalore",
    locality: "Indiranagar",
    tagline: "For the one who wants to live where everything happens.",
    story:
      "Step out of your door and into the best of Indiranagar — cafes, boutiques and the metro, all a short walk away. Compact by design, generous where it counts: an open-plan living space, a home-office nook, and a wraparound balcony that turns the skyline into your evening view.",
    description: [
      "The Meridian Sky Suites is a boutique twin-tower development a short walk from Indiranagar's 100 Feet Road, surrounded by cafes, boutiques and metro connectivity. This tenth-floor unit has an open-plan living-dining area, a home-office nook and a wraparound balcony.",
      "The building offers a rooftop lounge, co-working space and covered parking. As with every Nivasa listing, this home was individually curated.",
    ],
    bhk: "2 BHK",
    bhkNum: 2,
    areaLabel: "Carpet Area",
    area: "1,180 sqft",
    areaSqft: 1180,
    pricePaise: BigInt(980_000_000), // ₹98 Lakh
    latitude: 12.9719,
    longitude: 77.6412,
    amenities: ["LIFT", "SECURITY", "PARKING", "GYM", "STUDY"],
    weeklyViewingSlots: 4,
    hoodBlurb:
      "Indiranagar is Bangalore at its most alive — tree-lined 12th Main, design boutiques, cafes and the Purple Line, all within a short walk of your door.",
    hood: [
      ["TRANSIT", "Indiranagar Metro", "7 min walk"],
      ["DINING", "Toit Brewpub", "8 min walk"],
      ["SHOPPING", "100 Feet Road", "5 min walk"],
      ["PARK", "Indiranagar BDA Park", "6 min walk"],
      ["HEALTH", "Chinmaya Mission Hospital", "9 min walk"],
      ["WORK", "Embassy GolfLinks", "12 min drive"],
      ["SCHOOL", "New Horizon Public School", "10 min drive"],
    ],
    heroImageUrl:
      "https://images.pexels.com/photos/33619254/pexels-photo-33619254/free-photo-of-modern-residential-complex-with-twin-towers.png?auto=compress&w=1260&h=750&dpr=1",
    floorplanNote: "Illustrative floor plan — not to scale.",
  },
];

async function main() {
  for (const p of PROPERTIES) {
    const data = {
      name: p.name,
      location: p.location,
      locality: p.locality,
      tagline: p.tagline,
      story: p.story,
      description: p.description,
      bhk: p.bhk,
      bhkNum: p.bhkNum,
      areaLabel: p.areaLabel,
      area: p.area,
      areaSqft: p.areaSqft,
      pricePaise: p.pricePaise,
      latitude: p.latitude,
      longitude: p.longitude,
      amenities: p.amenities,
      weeklyViewingSlots: p.weeklyViewingSlots,
      hoodBlurb: p.hoodBlurb,
      heroImageUrl: p.heroImageUrl,
      videoUrl: SAMPLE_VIDEO,
      floorplanUrl: svgUri(FLOORPLANS[p.slug]),
      floorplanNote: p.floorplanNote,
      status: "PUBLISHED" as const,
    };

    const property = await prisma.property.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, publishedAt: new Date(), ...data },
      update: data,
      select: { id: true, name: true },
    });

    // Child collections are replaced, so re-running never duplicates a gallery.
    await prisma.propertyImage.deleteMany({ where: { propertyId: property.id } });
    await prisma.propertyImage.createMany({
      data: [
        { url: INTERIOR.living, alt: "Living room", sortOrder: 0 },
        { url: INTERIOR.bedroom, alt: "Bedroom", sortOrder: 1 },
        { url: INTERIOR.bath, alt: "Bathroom", sortOrder: 2 },
      ].map((image) => ({ propertyId: property.id, ...image })),
    });

    await prisma.hoodPlace.deleteMany({ where: { propertyId: property.id } });
    await prisma.hoodPlace.createMany({
      data: p.hood.map(([kind, name, distance], index) => ({
        propertyId: property.id,
        kind,
        name,
        distance,
        sortOrder: index,
      })),
    });

    console.log(`seeded ${property.name}`);
  }

  const total = await prisma.property.count();
  console.log(`${total} listing(s) in the catalogue`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
