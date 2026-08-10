import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { Prisma, type AdminRole } from "@prisma/client";

import type { ApiResponse } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

/**
 * The authorization spine.
 *
 *   - `middleware.ts` does AUTHENTICATION only — session or no session.
 *   - AUTHORIZATION lives here, called as the first statement of every protected handler:
 *         const session = await requireRole("CURATOR");
 *
 * `grep -rn "requireRole\|requireSession" app/api/` enumerates every guarded route, so a
 * handler missing that call is a visible omission rather than an invisible gap in a regex.
 *
 * Fail-closed is the point. No Clerk user → deny. Clerk user with no `Admin` row → deny.
 * Clerk not configured at all → deny. There is no branch where an unknown caller is
 * treated as authorized.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────

export type Session = {
  adminId: string;
  role: AdminRole;
  email: string;
  name: string | null;
  clerkUserId: string;
};

/**
 * Ranked, never compared for equality: `requireRole("CURATOR")` admits OWNER and CURATOR and
 * refuses VIEWER. A new role added to the enum without a rank here is a type error, not a
 * silent bypass.
 */
export const ROLE_RANK: Record<AdminRole, number> = {
  OWNER: 3,
  CURATOR: 2,
  VIEWER: 1,
};

export function hasRole(role: AdminRole, minimum: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** True when Clerk keys are present. The admin surface is unreachable without them. */
export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// How authorization failures surface
// ─────────────────────────────────────────────────────────────────────────────

export type AuthErrorCode = "UNAUTHENTICATED" | "NO_ADMIN" | "FORBIDDEN" | "NOT_CONFIGURED";

/**
 * Thrown by `requireSession()` / `requireRole()`. Handlers do not catch it — `withApiErrors`
 * does. Throwing rather than returning a union is deliberate: a forgotten check cannot
 * silently continue into the query, and a handler that forgets the wrapper fails closed with
 * a 500 rather than open with a 200.
 */
export class AuthError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, status: 401 | 403 | 503, message: string) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

/** Raised by lib functions for conditions a handler should surface verbatim. */
export class DomainError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "DomainError";
    this.status = status;
  }
}

/** Client-safe JSON body. Never carries a Prisma error, a stack, or a record id. */
export function apiError(error: string, status: number): NextResponse {
  return NextResponse.json<ApiResponse<never>>({ success: false, error }, { status });
}

export function apiOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json<ApiResponse<T>>({ success: true, data }, { status });
}

/**
 * Wraps a route handler so `AuthError` becomes 401/403, `DomainError` becomes its own status,
 * and anything unexpected becomes a generic 500 — detail to the server log, never the client.
 *
 * Every handler under app/api is wrapped. That is what makes "you cannot forget the session
 * check" true: `requireRole()` throws, and this wrapper is the only thing that turns a throw
 * into a response.
 */
export function withApiErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof AuthError) return apiError(err.message, err.status);
      if (err instanceof DomainError) return apiError(err.message, err.status);

      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2002") return apiError("That value is already taken", 409);
        if (err.code === "P2025") return apiError("Not found", 404);
      }
      if (err instanceof Prisma.PrismaClientInitializationError) {
        console.error("[api] database unavailable", err.message);
        return apiError("The service is temporarily unavailable", 503);
      }

      console.error("[api] unhandled error", err);
      return apiError("Something went wrong", 500);
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Clerk identity
// ─────────────────────────────────────────────────────────────────────────────

export type ClerkIdentity = {
  clerkUserId: string;
  email: string | null;
  name: string | null;
};

export async function getClerkUserId(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch {
    // auth() throws when clerkMiddleware did not run for this path. Deny, never assume.
    return null;
  }
}

/** Costs a round trip to Clerk, so only the bootstrap route asks for it. */
export async function getClerkIdentity(): Promise<ClerkIdentity | null> {
  const userId = await getClerkUserId();
  if (!userId) return null;

  const user = await currentUser().catch(() => null);
  const email =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
  const name =
    user?.fullName ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ?? null;

  return { clerkUserId: userId, email, name: name || null };
}

// ─────────────────────────────────────────────────────────────────────────────
// getSession / requireSession / requireRole
// ─────────────────────────────────────────────────────────────────────────────

export async function getSession(): Promise<Session | null> {
  const clerkUserId = await getClerkUserId();
  if (!clerkUserId) return null;

  const admin = await prisma.admin
    .findUnique({
      where: { clerkUserId },
      select: { id: true, role: true, email: true, name: true },
    })
    .catch(() => null);
  if (!admin) return null;

  return {
    adminId: admin.id,
    role: admin.role,
    email: admin.email,
    name: admin.name,
    clerkUserId,
  };
}

/** A session or a thrown `AuthError`. There is no third outcome. */
export async function requireSession(): Promise<Session> {
  if (!isAuthConfigured()) {
    throw new AuthError("NOT_CONFIGURED", 503, "Admin access is not configured");
  }

  const clerkUserId = await getClerkUserId();
  if (!clerkUserId) throw new AuthError("UNAUTHENTICATED", 401, "Sign in to continue");

  const admin = await prisma.admin.findUnique({
    where: { clerkUserId },
    select: { id: true, role: true, email: true, name: true },
  });
  if (!admin) {
    // Signed in to Clerk but not on the curation team. Distinct from 401 so the dashboard can
    // say so rather than bouncing them back to a sign-in page they just completed.
    throw new AuthError("NO_ADMIN", 403, "This account is not on the Nivasa team");
  }

  return {
    adminId: admin.id,
    role: admin.role,
    email: admin.email,
    name: admin.name,
    clerkUserId,
  };
}

export async function requireRole(minimum: AdminRole): Promise<Session> {
  const session = await requireSession();
  if (!hasRole(session.role, minimum)) {
    throw new AuthError("FORBIDDEN", 403, "You do not have access to this action");
  }
  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Turns the first signed-in Clerk user into the OWNER. Every later account has to be added by
 * an existing OWNER, so this is not a standing back door: it only fires while the `Admin`
 * table is empty, and the check is inside the transaction rather than before it, so two
 * concurrent callers cannot both become OWNER.
 */
export async function bootstrapFirstAdmin(
  identity: ClerkIdentity,
): Promise<{ ok: true; role: AdminRole } | { ok: false; error: string; status: number }> {
  if (!identity.email) {
    return { ok: false, status: 400, error: "Your Clerk account has no email address", };
  }

  try {
    const role = await prisma.$transaction(async (tx) => {
      const count = await tx.admin.count();
      if (count > 0) return null;
      const admin = await tx.admin.create({
        data: {
          clerkUserId: identity.clerkUserId,
          email: identity.email!,
          name: identity.name,
          role: "OWNER",
        },
        select: { role: true },
      });
      return admin.role;
    });

    if (!role) {
      return { ok: false, status: 403, error: "The team already exists — ask an owner to add you" };
    }
    return { ok: true, role };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, status: 409, error: "This account is already on the team" };
    }
    throw err;
  }
}
