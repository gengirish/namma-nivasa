import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * AUTHENTICATION ONLY.
 *
 * This file decides one thing: does the request need a signed-in Clerk user. It does not decide
 * what that user may do. Path patterns drift from real routing, and a route the matcher fails to
 * cover is then silently unguarded — so authorization lives in `requireRole()` (lib/auth.ts),
 * called as the first statement of every protected handler. A missing guard is then a visible
 * omission in the handler rather than an invisible gap in a regex here.
 *
 * Default posture is PUBLIC. The whole visitor-facing site — listings, enquiries, the owner
 * intake — is browsable with no account by design, so the protected set is the explicit one and
 * everything else falls through.
 */

const isProtectedRoute = createRouteMatcher(["/dashboard(.*)", "/api/admin(.*)"]);

/**
 * Public and self-verifying. Listed so the boundary is greppable:
 *   /api/admin/bootstrap — the one route that cannot require an Admin row, because its whole
 *                          purpose is a Clerk user who does not have one yet. It sits under an
 *                          otherwise-protected prefix, so without this line the first owner
 *                          could never be created. Rate-limited in the handler instead.
 *
 * Anything added under an already-protected prefix that verifies itself needs a line here, or
 * its self-verification is dead code.
 */
const isSelfVerifyingRoute = createRouteMatcher(["/api/admin/bootstrap"]);

const SIGN_IN_URL = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in";

const clerkGuard = clerkMiddleware(async (auth, req: NextRequest) => {
  if (isSelfVerifyingRoute(req) || !isProtectedRoute(req)) return NextResponse.next();

  // Signed in or not. That is the entire decision made here.
  const { userId } = await auth();
  if (userId) return NextResponse.next();

  // Pages get a redirect; APIs get the same JSON 401 shape every other error uses, so a fetch()
  // never has to parse an HTML error page.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ success: false, error: "Sign in to continue" }, { status: 401 });
  }

  const signIn = new URL(SIGN_IN_URL, req.url);
  signIn.searchParams.set("redirect_url", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(signIn);
});

/**
 * With no Clerk keys the app still has to boot and serve the public site — `clerkMiddleware`
 * would throw on every request. It degrades to a pass-through, and `requireRole()` refuses
 * everything with a 503, so the dashboard is unreachable rather than unguarded.
 */
const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export default clerkConfigured ? clerkGuard : () => NextResponse.next();

export const config = {
  matcher: [
    // Everything except Next internals and static files, unless a search param is present.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|webmanifest)).*)",
    // Clerk's Frontend API auto-proxy. Unused while `frontendApiProxy` is off, but the pattern
    // above excludes nothing that would route it, so switching the proxy on without this line
    // fails at the network layer rather than anywhere that names Clerk.
    "/__clerk/:path*",
    "/(api|trpc)(.*)",
  ],
};
