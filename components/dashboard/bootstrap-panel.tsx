"use client";

import { SignInButton, UserButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SERIF } from "./ui";

const panel: React.CSSProperties = {
  maxWidth: 460,
  background: "#fff",
  border: "1px solid #ECE5DB",
  borderRadius: 10,
  padding: "36px 32px",
  textAlign: "center",
};

const primary: React.CSSProperties = {
  padding: "13px 26px",
  background: "#A16207",
  color: "#fff",
  border: "1px solid #A16207",
  borderRadius: 2,
  cursor: "pointer",
  fontSize: "0.78rem",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontFamily: "inherit",
};

/**
 * What a signed-out visitor, and a signed-in stranger, see at /dashboard.
 *
 * The "claim this dashboard" button only appears while the team is empty. It calls
 * `/api/admin/bootstrap`, which enforces that same emptiness inside a transaction — this flag
 * decides what to render, never who gets access.
 */
export function BootstrapPanel({
  teamExists,
  signedIn,
}: {
  teamExists: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bootstrap", { method: "POST" });
      const payload = (await res.json().catch(() => null)) as
        | { success: false; error: string }
        | { success: true }
        | null;
      if (!res.ok || !payload?.success) {
        setError(payload && !payload.success ? payload.error : "Could not set that up");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={panel}>
      {!signedIn && (
        <>
        <h1 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.4rem", margin: "0 0 12px" }}>
          Sign in to continue
        </h1>
        <p style={{ color: "#57534E", fontSize: "0.94rem", fontWeight: 300, margin: "0 0 22px" }}>
          The dashboard is for the Nivasa curation team.
        </p>
        <SignInButton mode="modal">
          <button style={primary}>Sign in</button>
          </SignInButton>
        </>
      )}

      {signedIn && (
        <>
        <h1 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.4rem", margin: "0 0 12px" }}>
          {teamExists ? "You’re not on the team yet" : "Claim this dashboard"}
        </h1>
        <p style={{ color: "#57534E", fontSize: "0.94rem", fontWeight: 300, margin: "0 0 22px" }}>
          {teamExists
            ? "You’re signed in, but this account has no curator access. Ask an owner to add you."
            : "No one has set up the team yet. Claim it and you become the owner — after that, every account is added by an existing owner."}
        </p>
        {!teamExists && (
          <button onClick={() => void claim()} disabled={busy} style={{ ...primary, opacity: busy ? 0.7 : 1 }}>
            {busy ? "Setting up…" : "Make me the owner"}
          </button>
        )}
        {error && (
          <p style={{ color: "#991B1B", fontSize: "0.82rem", margin: "16px 0 0" }}>{error}</p>
        )}
          <div style={{ marginTop: 24, display: "flex", justifyContent: "center" }}>
            <UserButton />
          </div>
        </>
      )}
    </div>
  );
}
