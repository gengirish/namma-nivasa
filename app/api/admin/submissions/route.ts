import type { NextRequest } from "next/server";
import type { Prisma, SubmissionStatus } from "@prisma/client";

import { apiError, apiOk, requireRole, withApiErrors } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstIssueMessage, listQuerySchema } from "@/lib/validations";

/** GET /api/admin/submissions — the owner-intake queue. VIEWER+. */
export const dynamic = "force-dynamic";

const STATUSES = ["NEW", "REVIEWING", "ACCEPTED", "DECLINED"] as const;

export const GET = withApiErrors(async (req: NextRequest): Promise<Response> => {
  await requireRole("VIEWER");

  const parsed = listQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return apiError(firstIssueMessage(parsed.error), 400);
  const { status, q, limit, offset } = parsed.data;

  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return apiError("Unknown status filter", 400);
  }

  const where: Prisma.OwnerSubmissionWhereInput = {
    ...(status ? { status: status as SubmissionStatus } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { locality: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q } },
            { reference: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [submissions, total, counts] = await Promise.all([
    prisma.ownerSubmission.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      take: limit,
      skip: offset,
    }),
    prisma.ownerSubmission.count({ where }),
    prisma.ownerSubmission.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  return apiOk({
    submissions,
    total,
    limit,
    offset,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  });
});
