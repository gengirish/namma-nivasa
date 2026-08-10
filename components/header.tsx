"use client";

import { useNivasa } from "./nivasa-store";
import { SERIF } from "./ui";

const navButton: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#44403C",
  cursor: "pointer",
  fontSize: "inherit",
  letterSpacing: "inherit",
  fontFamily: "inherit",
  padding: "4px 0",
};

const mobileItem: React.CSSProperties = {
  textAlign: "left",
  background: "none",
  border: "none",
  borderBottom: "1px solid #ECE5DB",
  padding: "16px 0",
  color: "#44403C",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.95rem",
  letterSpacing: "0.04em",
};

export function Header() {
  const s = useNivasa();
  const savedShown = s.savedCount > 0;

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 80,
        background: "rgba(250,247,242,0.9)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid #ECE5DB",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "0 24px",
          height: 74,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <button
          onClick={s.goHome}
          style={{
            fontFamily: SERIF,
            fontSize: "1.12rem",
            letterSpacing: "0.18em",
            fontWeight: 700,
            color: "#0A0A0A",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          NAMA<span style={{ color: "#A16207" }}>NIVASA</span>
        </button>

        <nav
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontSize: "0.82rem",
            letterSpacing: "0.06em",
          }}
        >
          <span data-nav-links style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <button className="nv-navlink" onClick={s.exploreScroll} style={navButton}>
              Residences
            </button>
            <button className="nv-navlink" onClick={s.howScroll} style={navButton}>
              How it works
            </button>
            <button className="nv-navlink" onClick={s.openMap} style={navButton}>
              Map
            </button>
            <button className="nv-navlink" onClick={s.faqScroll} style={navButton}>
              FAQ
            </button>
            <button
              className="nv-navlink-gold"
              onClick={s.openList}
              style={{ ...navButton, color: "#A16207", fontWeight: 500 }}
            >
              List Property
            </button>
          </span>

          <button
            data-nav-saved
            className="nv-navlink"
            onClick={s.viewSaved}
            style={{ ...navButton, position: "relative" }}
          >
            Saved
            {savedShown && (
              <span
                style={{
                  position: "absolute",
                  top: -8,
                  right: -14,
                  background: "#A16207",
                  color: "#fff",
                  fontSize: "0.6rem",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {s.savedCount}
              </span>
            )}
          </button>

          <button
            className="nv-btn-dark"
            onClick={() => s.openModal("message", null)}
            style={{
              padding: "9px 20px",
              background: "#1C1917",
              color: "#fff",
              border: "1px solid #1C1917",
              borderRadius: 2,
              cursor: "pointer",
              fontSize: "0.74rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontFamily: "inherit",
            }}
          >
            Enquire
          </button>

          <button
            data-nav-toggle
            onClick={s.toggleMenu}
            aria-label="Menu"
            aria-expanded={s.mobileMenu}
            style={{
              alignItems: "center",
              justifyContent: "center",
              width: 40,
              height: 40,
              background: "none",
              border: "1px solid #E4DCD0",
              borderRadius: 2,
              color: "#1C1917",
              cursor: "pointer",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              {s.mobileMenu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </nav>
      </div>

      {s.mobileMenu && (
        <div
          data-mobile-menu
          style={{
            borderTop: "1px solid #ECE5DB",
            background: "rgba(250,247,242,0.98)",
            animation: "nvmodal .2s ease",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", padding: "8px 24px 18px" }}>
            <button onClick={s.exploreScroll} style={mobileItem}>
              Residences
            </button>
            <button onClick={s.howScroll} style={mobileItem}>
              How it works
            </button>
            <button onClick={s.openMap} style={mobileItem}>
              Map
            </button>
            <button onClick={s.openList} style={mobileItem}>
              List your home
            </button>
            <button onClick={s.faqScroll} style={mobileItem}>
              FAQ
            </button>
            <button
              onClick={s.viewSaved}
              style={{
                ...mobileItem,
                borderBottom: "none",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              Saved
              {savedShown && (
                <span
                  style={{
                    background: "#A16207",
                    color: "#fff",
                    fontSize: "0.62rem",
                    minWidth: 18,
                    height: 18,
                    padding: "0 5px",
                    borderRadius: 9,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {s.savedCount}
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
