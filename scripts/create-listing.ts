/**
 * Creates a catalogue listing from a JSON file.
 *
 *     npm run listing:create -- prisma/listings/sobha-manhattan-towers-townpark.json
 *
 * Exists because there is no listing editor UI and `POST /api/admin/properties` needs a Clerk
 * session — which is unavailable on an environment with no Clerk keys, and awkward for the
 * first listing of all, when there is no Admin row to sign in as yet.
 *
 * It is the same write the route performs: parse with `propertyCreateSchema`, hand the result
 * to `createProperty()`. No second spelling of the transaction, so a listing made here and a
 * listing made through the dashboard cannot drift apart.
 *
 * The listing lands as DRAFT, exactly as the route leaves it. Publishing stays a deliberate
 * PATCH from /dashboard/properties.
 *
 * Keys beginning with `_` are provenance notes for whoever reviews the file. Zod strips unknown
 * keys, so they never reach the database — but keeping them beside the data is what makes an
 * assumed area visible to the next reader instead of looking like a measured one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createProperty } from "@/lib/admin-properties";
import { prisma } from "@/lib/prisma";
import { propertyCreateSchema } from "@/lib/validations";

import { databaseTarget } from "./db-target";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: npm run listing:create -- <path-to-listing.json>");
    console.error("  the `--` matters; without it npm keeps the argument for itself.");
    console.error("\ne.g. npm run listing:create -- prisma/listings/my-home.json");
    console.error(`\nWould have written to: ${databaseTarget()}`);
    process.exit(1);
  }

  console.log(`Database: ${databaseTarget()}`);

  const path = resolve(process.cwd(), arg);
  const raw = JSON.parse(readFileSync(path, "utf8"));

  const notes: string[] = Array.isArray(raw._assumptions) ? raw._assumptions : [];

  const parsed = propertyCreateSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`${path} does not describe a listing:\n`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }

  const property = await createProperty(parsed.data);

  console.log(`Created ${property.slug} as DRAFT (${property.id})`);
  console.log(`  ₹${(parsed.data.pricePaise / 100).toLocaleString("en-IN")}`);
  console.log(`  ${parsed.data.images.length} images, ${parsed.data.hood.length} neighbourhood entries`);

  if (notes.length) {
    console.log(`\nUnverified in this listing — settle these before publishing:`);
    for (const note of notes) console.log(`  • ${note}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
