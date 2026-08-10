import type { NextRequest } from "next/server";

import { apiError, apiOk, withApiErrors } from "@/lib/auth";
import { findPublishedPropertyRef } from "@/lib/properties";
import { istDateString } from "@/lib/slots";
import { isoDateSchema } from "@/lib/validations";
import { dayAvailability } from "@/lib/viewings";

/**
 * GET /api/properties/[slug]/availability?date=YYYY-MM-DD — which times are still open.
 *
 * Public and uncached: the picker asks for this the moment a visitor changes the date, and a
 * cached answer is how two people are shown the same free slot.
 */
export const dynamic = "force-dynamic";

export const GET = withApiErrors(
  async (req: NextRequest, ctx: { params: Promise<{ slug: string }> }): Promise<Response> => {
    const { slug } = await ctx.params;

    const requested = req.nextUrl.searchParams.get("date") ?? istDateString();
    const parsed = isoDateSchema.safeParse(requested);
    if (!parsed.success) return apiError("Pick a date", 400);

    const property = await findPublishedPropertyRef(slug);
    if (!property) return apiError("That home is no longer listed", 404);

    return apiOk(await dayAvailability(property, parsed.data));
  },
);
