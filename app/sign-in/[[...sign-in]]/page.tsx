import { SignIn } from "@clerk/nextjs";

import { ClerkBoundary, clerkEnabled } from "@/components/clerk-boundary";
import { AuthShell, NotConfigured } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — Nivasa" };

export default function SignInPage() {
  if (!clerkEnabled) {
    return (
      <AuthShell title="Sign in">
        <NotConfigured />
      </AuthShell>
    );
  }

  return (
    <ClerkBoundary>
      <AuthShell title="Nivasa team">
        <SignIn
          appearance={{
            variables: { colorPrimary: "#A16207", colorBackground: "#FFFFFF", borderRadius: "2px" },
          }}
        />
      </AuthShell>
    </ClerkBoundary>
  );
}
