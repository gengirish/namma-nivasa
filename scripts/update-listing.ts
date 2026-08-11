/**
 * Updates an existing catalogue listing from the same JSON file that created it.
 *
 *     npm run listing:update -- prisma/listings/sobha-manhattan-towers-townpark.json
 *
 * The companion to create-listing.ts, and it exists for the same reason: there is no listing
 * editor UI, so the only other way to correct a published listing is a hand-rolled PATCH.
 *
 * It matches on `slug`, so the file stays the editable source of truth for a listing — fix the
 * area in the JSON, run this, and the row agrees with the file again.
 *
 * Two behaviours worth knowing, both inherited from updateProperty() rather than invented here:
 *
 *   - `status` is only written when the input carries one. The listing files do not, so running
 *     this against a PUBLISHED listing edits it in place and leaves it published. Editing is
 *     never an accidental unpublish.
 *   - Gallery and neighbourhood rows are replaced wholesale, not diffed. The array in the file
 *     is what the listing then has.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { updateProperty } from "@/lib/admin-properties";
import { prisma } from "@/lib/prisma";
import { propertyUpdateSchema } from "@/lib/validations";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: tsx scripts/update-listing.ts <path-to-listing.json>");
    process.exit(1);
  }

  const path = resolve(process.cwd(), arg);
  const raw = JSON.parse(readFileSync(path, "utf8"));

  if (!raw.slug) {
    console.error(`${path} has no "slug", so there is nothing to match an existing listing on.`);
    process.exit(1);
  }

  const existing = await prisma.property.findUnique({
    where: { slug: raw.slug },
    select: { id: true, status: true },
  });
  if (!existing) {
    console.error(`No listing with slug "${raw.slug}". Use listing:create for a new one.`);
    process.exit(1);
  }

  const parsed = propertyUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`${path} does not describe a listing:\n`);
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }

  // Only used to stamp publishedBy on a first publish, which this never performs — but
  // updateProperty demands one, and an OWNER is the honest answer for a scripted edit.
  const admin =
    (await prisma.admin.findFirst({ where: { role: "OWNER" }, select: { id: true } })) ??
    (await prisma.admin.findFirst({ select: { id: true } }));
  if (!admin) {
    console.error("No Admin row exists. Bootstrap one before editing listings.");
    process.exit(1);
  }

  const property = await updateProperty(existing.id, parsed.data, admin.id);
  console.log(`Updated ${property.slug} — still ${property.status}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
