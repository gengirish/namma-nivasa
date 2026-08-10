import { apiError, apiOk, withApiErrors } from "@/lib/auth";
import { findPublishedProperty } from "@/lib/properties";

/** GET /api/properties/[slug] — one published listing. Public. */
export const dynamic = "force-dynamic";

export const GET = withApiErrors(
  async (_req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> => {
    const { slug } = await ctx.params;
    const property = await findPublishedProperty(slug);
    if (!property) return apiError("That home is no longer listed", 404);
    return apiOk(property);
  },
);
