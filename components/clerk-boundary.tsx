import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";

/**
 * ClerkProvider, scoped rather than mounted at the root.
 *
 * The public site has no accounts by design, so mounting Clerk in `app/layout.tsx` would load
 * an auth client for every visitor who will never sign in — and would make `npm run build` fail
 * on a clean clone with no keys. It is mounted here instead and used only by the segments that
 * need it: /dashboard and /sign-in.
 */

export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function ClerkBoundary({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return <>{children}</>;
  return <ClerkProvider>{children}</ClerkProvider>;
}
