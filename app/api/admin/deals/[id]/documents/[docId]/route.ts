import type { NextRequest } from "next/server";

import { requireRole, withApiErrors } from "@/lib/auth";
import { getDocumentHtml } from "@/lib/deals";

/**
 * GET /api/admin/deals/[id]/documents/[docId] — one stored version, as the printable HTML page
 * it was rendered to (PANs masked). CURATOR+.
 *
 * Served as a document rather than JSON so a curator can open and print it. It is still a team
 * record: `no-store` keeps it out of every cache, and the CSP `sandbox` gives the page an opaque
 * origin with scripts disabled, so nothing inside a rendered document can reach the dashboard's
 * cookies or call the admin API. Errors still come back as the JSON envelope via withApiErrors.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; docId: string }> };

const DOCUMENT_CSP = [
  "sandbox allow-modals",
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: https:",
].join("; ");

export const GET = withApiErrors(async (_req: NextRequest, ctx: Ctx): Promise<Response> => {
  await requireRole("CURATOR");
  const { id, docId } = await ctx.params;

  const html = await getDocumentHtml(id, docId);
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": DOCUMENT_CSP,
    },
  });
});
