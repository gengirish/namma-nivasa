"use client";

import { useNivasa } from "./nivasa-store";
import { SERIF } from "./ui";

const footLink: React.CSSProperties = {
  color: "#D6D3D1",
  background: "none",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  fontSize: "inherit",
  fontFamily: "inherit",
  padding: 0,
};

export function Footer() {
  const s = useNivasa();

  return (
    <footer style={{ background: "#1C1917", color: "#fff", padding: "64px 24px 30px" }}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "flex",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 28,
        }}
      >
        <div style={{ maxWidth: 360 }}>
          <button
            onClick={s.goHome}
            style={{
              fontFamily: SERIF,
              fontSize: "1.12rem",
              letterSpacing: "0.18em",
              fontWeight: 700,
              color: "#fff",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            NAMA<span style={{ color: "#C99A3F" }}>NIVASA</span>
          </button>
          <p style={{ color: "#B7B2AC", fontSize: "0.85rem", marginTop: 12, fontWeight: 300 }}>
            Every home on Nivasa is curated individually — no automated feeds, no noise.
          </p>
          <p style={{ marginTop: 14, fontSize: "0.72rem", color: "#857f79" }}>
            *RERA registration number placeholder — replace with the real registration before
            going live.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: "0.85rem" }}>
          <p
            style={{
              fontSize: "0.72rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#B7B2AC",
              margin: "0 0 4px",
            }}
          >
            Get in touch
          </p>
          <button
            className="nv-footlink"
            onClick={() => s.openModal("message", null)}
            style={footLink}
          >
            Message us
          </button>
          <button className="nv-footlink" onClick={s.openList} style={footLink}>
            List your home
          </button>
          <button
            className="nv-footlink"
            onClick={() => s.showToast("Add a real Privacy Policy page before launch.")}
            style={footLink}
          >
            Privacy Policy
          </button>
          <button
            className="nv-footlink"
            onClick={() => s.showToast("Add real Terms of Service before launch.")}
            style={footLink}
          >
            Terms of Service
          </button>
        </div>
      </div>

      <p
        style={{
          maxWidth: 1200,
          margin: "36px auto 0",
          borderTop: "1px solid #3a3532",
          paddingTop: 18,
          fontSize: "0.74rem",
          color: "#857f79",
        }}
      >
        © 2026 Nivasa. All homes curated, none listed automatically. Photography courtesy of
        Pexels contributors — placeholders until real listing photography is uploaded.
      </p>
    </footer>
  );
}
