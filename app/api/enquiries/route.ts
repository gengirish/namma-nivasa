import type { NextRequest } from "next/server";

import { apiError, apiOk, withApiErrors } from "@/lib/auth";
import { createEnquiry } from "@/lib/enquiries";
import { getClientIp, rateLimitAsync } from "@/lib/rate-limit";
import { enquiryCreateSchema, firstIssueMessage } from "@/lib/validations";

/**
 * POST /api/enquiries — public, rate-limited.
 *
 * This is the endpoint that mutates something scarce before anyone has been identified: a
 * booked slot takes an hour off a real owner's week. Six an hour per address is generous for a
 * person deciding between two homes and useless for a script filling an owner's calendar.
 */
export const dynamic = "force-dynamic";

const LIMIT = 6;
const WINDOW_MS = 60 * 60_000;

export const POST = withApiErrors(async (req: NextRequest): Promise<Response> => {
  const ip = getClientIp(req);
  if (!(await rateLimitAsync(`enquiry:${ip}`, LIMIT, WINDOW_MS))) {
    return apiError("Too many enquiries from this connection — try again shortly", 429);
  }

  const raw = await req.json().catch(() => null);
  const parsed = enquiryCreateSchema.safeParse(raw);
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);

  const receipt = await createEnquiry(parsed.data);
  return apiOk(receipt, 201);
});
