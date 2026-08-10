import { NivasaApp } from "@/components/nivasa-app";
import { listPublishedProperties } from "@/lib/properties";

/**
 * Availability is part of the payload and changes whenever anyone books, so the page is
 * rendered per request rather than at build time.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const properties = await listPublishedProperties();
  return <NivasaApp properties={properties} />;
}
