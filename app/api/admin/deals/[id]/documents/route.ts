import type { NextRequest } from "next/server";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { renderDocument } from "@/lib/deals";
import { dealRenderSchema, firstIssueMessage } from "@/lib/validations";

/**
 * POST /api/admin/deals/[id]/documents — render and store a new version of one document.
 * CURATOR+.
 *
 * `fullPans` (keyed by party name) reach the returned `html` once and are never stored: the
 * version written to the database is always the masked render (handover §7). A `final` render
 * is refused with 422 while the consistency checker reports errors.
 *
 * Responds 201 `{ document, html, issues }`.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApiErrors(async (req: NextRequest, ctx: Ctx): Promise<Response> => {
  const session = await requireRole("CURATOR");
  const { id } = await ctx.params;

  const raw = await req.json().catch(() => null);
  const parsed = dealRenderSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);
  const { kind, final, fullPans } = parsed.data;

  const result = await renderDocument(id, kind, { final, fullPans }, session.adminId);
  return apiOk(result, 201);
});
