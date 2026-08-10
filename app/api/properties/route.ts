import { apiOk, withApiErrors } from "@/lib/auth";
import type { PropertyDto } from "@/lib/dto";
import { listPublishedProperties } from "@/lib/properties";

/**
 * GET /api/properties — the published collection, with live availability. Public.
 *
 * Availability changes whenever anyone books, so this is never cached.
 */
export const dynamic = "force-dynamic";

export const GET = withApiErrors(async (): Promise<Response> => {
  const properties = await listPublishedProperties();
  return apiOk<{ properties: PropertyDto[] }>({ properties });
});
