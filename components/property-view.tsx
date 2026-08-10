"use client";

import { downloadBrochure, shareOnWhatsApp } from "@/lib/brochure";
import { AMENITY_LABEL, HOOD_LABEL } from "@/lib/content";
import type { PropertyDto } from "@/lib/dto";
import {
  AMENITY_ICON,
  FLOORPLAN_PLACEHOLDER,
  HOOD_ICON,
  imagePlaceholder,
  propertyPlaceholder,
  svgUri,
} from "@/lib/graphics";

import { useNivasa } from "./nivasa-store";
import { AvailabilityDot, Eyebrow, Heart, Photo, Reveal, SERIF } from "./ui";

const actionButton: React.CSSProperties = {
  width: "100%",
  marginBottom: 12,
  padding: 15,
  borderRadius: 2,
  cursor: "pointer",
  fontSize: "0.78rem",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  fontFamily: "inherit",
};

const smallAction: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: 13,
  background: "transparent",
  color: "#C0BAB2",
  border: "1px solid #4a423b",
  borderRadius: 2,
  cursor: "pointer",
  fontSize: "0.72rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontFamily: "inherit",
};

function DarkEyebrow({ children }: { children: React.ReactNode }) {
  return <Eyebrow tone="goldLight">{children}</Eyebrow>;
}

export function PropertyView({ property }: { property: PropertyDto }) {
  const s = useNivasa();
  const avail = property.availability;
  const saved = s.isSaved(property.slug);
  const heroFallback = svgUri(propertyPlaceholder(property.name));
  const soldOut = avail.slotsLeft === 0;

  return (
    <main style={{ background: "#141110", minHeight: "100vh" }}>
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "20px 24px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <button
          className="nv-btn-ghost-dark"
          onClick={s.goHome}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "1px solid #4a423b",
            borderRadius: 2,
            padding: "9px 18px",
            color: "#F5F0E8",
            cursor: "pointer",
            fontSize: "0.76rem",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "inherit",
          }}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back to homes
        </button>
        <p style={{ fontSize: "0.8rem", color: "#948C84", letterSpacing: "0.03em", margin: 0 }}>
          <button
            onClick={s.goHome}
            style={{
              background: "none",
              border: "none",
              color: "#C99A3F",
              cursor: "pointer",
              fontSize: "inherit",
              fontFamily: "inherit",
              padding: 0,
            }}
          >
            Home
          </button>
          <span style={{ margin: "0 8px" }}>/</span>
          <span>{property.name}</span>
        </p>
      </div>

      {/* ------------------------------------------------------------- hero */}
      <section
        style={{
          position: "relative",
          height: "58vh",
          minHeight: 420,
          background: "#1C1917",
          display: "flex",
          alignItems: "flex-end",
          overflow: "hidden",
          marginTop: 16,
        }}
      >
        <Photo
          src={property.heroImageUrl}
          fallback={heroFallback}
          alt={`${property.name} exterior`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.92,
            animation: "nvken 22s ease-in-out infinite alternate",
            filter: "saturate(1.05) contrast(1.03)",
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 2,
            width: "100%",
            padding: "44px 0 30px",
            background: "linear-gradient(0deg,rgba(12,10,9,0.85) 0%,rgba(12,10,9,0) 70%)",
          }}
        >
          <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
            <DarkEyebrow>{property.location}</DarkEyebrow>
            <h1
              style={{
                fontFamily: SERIF,
                fontWeight: 600,
                color: "#fff",
                fontSize: "clamp(2rem,4.4vw,3.3rem)",
                margin: "8px 0 0",
              }}
            >
              {property.name}
            </h1>
          </div>
        </div>
      </section>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>
        {/* ------------------------------------------------------- gallery */}
        {s.gallery.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
              gap: 12,
              margin: "26px 0 40px",
            }}
          >
            {s.gallery.map((g, i) => (
              <Reveal
                key={`${g.url}-${i}`}
                as="button"
                onClick={() => s.openLightbox(i)}
                style={{
                  border: "none",
                  padding: 0,
                  background: "#1C1917",
                  borderRadius: 3,
                  overflow: "hidden",
                  cursor: "pointer",
                  aspectRatio: "4 / 3",
                }}
              >
                <Photo
                  src={g.url}
                  fallback={svgUri(imagePlaceholder(g.alt))}
                  alt={g.alt}
                  loading="lazy"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    filter: "saturate(1.05) contrast(1.03)",
                  }}
                />
              </Reveal>
            ))}
          </div>
        )}

        <div
          data-detailbody
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr",
            gap: 64,
            paddingBottom: 80,
          }}
        >
          {/* ------------------------------------------------------ story */}
          <div>
            <DarkEyebrow>Why we chose this home</DarkEyebrow>
            <p
              style={{
                fontFamily: SERIF,
                fontStyle: "italic",
                fontSize: "1.5rem",
                color: "#F5F0E8",
                lineHeight: 1.4,
                margin: "14px 0 22px",
              }}
            >
              {property.tagline}
            </p>
            <p style={{ color: "#C0BAB2", fontSize: "1rem", fontWeight: 300, margin: "0 0 28px" }}>
              {property.story}
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
                gap: 24,
                margin: "32px 0",
              }}
            >
              {[
                { label: "Configuration", value: property.bhk },
                { label: property.areaLabel, value: property.area },
                { label: "Locality", value: property.locality },
              ].map((spec) => (
                <div key={spec.label} style={{ borderTop: "1px solid #2e2825", paddingTop: 16 }}>
                  <p
                    style={{
                      fontSize: "0.7rem",
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "#948C84",
                      margin: "0 0 6px",
                    }}
                  >
                    {spec.label}
                  </p>
                  <p style={{ fontFamily: SERIF, fontSize: "1.3rem", color: "#F5F0E8", margin: 0 }}>
                    {spec.value}
                  </p>
                </div>
              ))}
            </div>

            <div style={{ margin: "0 0 32px" }}>
              {property.description.map((para, i) => (
                <p key={i} style={{ color: "#C0BAB2", fontWeight: 300, margin: "0 0 16px" }}>
                  {para}
                </p>
              ))}
            </div>

            {property.amenities.length > 0 && (
              <>
                <DarkEyebrow>Amenities</DarkEyebrow>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))",
                    gap: 16,
                    margin: "16px 0 32px",
                  }}
                >
                  {property.amenities.map((a) => (
                    <div
                      key={a}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 10,
                        textAlign: "center",
                        padding: "18px 10px",
                        border: "1px solid #2e2825",
                        borderRadius: 5,
                        fontSize: "0.8rem",
                        color: "#C0BAB2",
                      }}
                    >
                      <Photo src={svgUri(AMENITY_ICON[a])} alt="" style={{ width: 24, height: 24 }} />
                      <span>{AMENITY_LABEL[a]}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* -------------------------------------------------- video */}
            {property.videoUrl && (
              <>
                <DarkEyebrow>Video Tour</DarkEyebrow>
                <button
                  onClick={s.openVideo}
                  aria-label={`Play the ${property.name} video tour`}
                  style={{
                    position: "relative",
                    display: "block",
                    width: "100%",
                    aspectRatio: "16 / 9",
                    border: "none",
                    padding: 0,
                    margin: "16px 0 8px",
                    borderRadius: 6,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "#1C1917",
                  }}
                >
                  <Photo
                    src={property.heroImageUrl}
                    fallback={heroFallback}
                    alt={`${property.name} video tour`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      filter: "brightness(0.72) saturate(1.05)",
                    }}
                  />
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span
                      style={{
                        width: 74,
                        height: 74,
                        borderRadius: "50%",
                        background: "rgba(250,247,242,0.94)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: "0 10px 30px -8px rgba(0,0,0,0.5)",
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="28" height="28" fill="#A16207" style={{ marginLeft: 4 }} aria-hidden="true">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </span>
                  </span>
                  <span
                    style={{
                      position: "absolute",
                      left: 16,
                      bottom: 14,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px",
                      background: "rgba(12,10,9,0.55)",
                      backdropFilter: "blur(4px)",
                      borderRadius: 20,
                      color: "#fff",
                      fontSize: "0.72rem",
                      letterSpacing: "0.05em",
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C99A3F" }} />
                    Walkthrough
                  </span>
                </button>
                <div style={{ marginBottom: 32 }} />
              </>
            )}

            {/* ---------------------------------------------- floor plan */}
            <DarkEyebrow>Floor Plan</DarkEyebrow>
            <div
              style={{
                border: "1px solid #2e2825",
                borderRadius: 6,
                overflow: "hidden",
                background: "#1F1B18",
                margin: "16px 0 8px",
              }}
            >
              <Photo
                src={property.floorplanUrl ?? svgUri(FLOORPLAN_PLACEHOLDER)}
                fallback={svgUri(FLOORPLAN_PLACEHOLDER)}
                alt={`${property.name} floor plan`}
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
            <p style={{ fontSize: "0.7rem", color: "#7d766f", margin: "0 0 32px" }}>
              {property.floorplanNote ?? "Illustrative floor plan — not to scale."}
            </p>

            {/* -------------------------------------------- neighbourhood */}
            {property.hood.length > 0 && (
              <>
                <DarkEyebrow>Neighbourhood</DarkEyebrow>
                <p
                  style={{
                    color: "#C0BAB2",
                    fontSize: "1rem",
                    fontWeight: 300,
                    margin: "12px 0 20px",
                    textWrap: "pretty",
                  }}
                >
                  {property.hoodBlurb}
                </p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))",
                    gap: 12,
                    margin: "0 0 32px",
                  }}
                >
                  {property.hood.map((place) => (
                    <Reveal
                      key={`${place.kind}-${place.name}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "14px 16px",
                        border: "1px solid #2e2825",
                        borderRadius: 6,
                        background: "#1F1B18",
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          background: "#26211D",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Photo src={svgUri(HOOD_ICON[place.kind])} alt="" style={{ width: 22, height: 22 }} />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <p
                          style={{
                            fontSize: "0.92rem",
                            color: "#F5F0E8",
                            margin: "0 0 2px",
                            fontWeight: 400,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {place.name}
                        </p>
                        <p style={{ fontSize: "0.74rem", color: "#948C84", margin: 0, letterSpacing: "0.02em" }}>
                          {HOOD_LABEL[place.kind]} · {place.distance}
                        </p>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* ------------------------------------------------ action card */}
          <aside
            data-actioncard
            style={{
              height: "fit-content",
              position: "sticky",
              top: 96,
              background: "#1F1B18",
              border: "1px solid #2e2825",
              borderRadius: 6,
              padding: 32,
              boxShadow: "0 12px 40px -24px rgba(28,25,23,0.35)",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 16,
                padding: "6px 12px",
                background: "#26211D",
                border: "1px solid #2e2825",
                borderRadius: 20,
                fontSize: "0.72rem",
                letterSpacing: "0.04em",
                color: "#C0BAB2",
              }}
            >
              <AvailabilityDot colour={avail.dot} />
              {avail.line}
            </div>
            <p style={{ fontFamily: SERIF, fontSize: "1.35rem", color: "#F5F0E8", margin: 0 }}>
              {property.name}
            </p>
            <p style={{ color: "#948C84", fontSize: "0.9rem", margin: "8px 0 24px" }}>
              {property.location} · {property.bhk} · {property.area}
            </p>

            <button
              className="nv-btn-gold"
              onClick={() => s.openModal("call", property)}
              disabled={soldOut}
              style={{
                ...actionButton,
                background: soldOut ? "#3a332c" : "#A16207",
                color: soldOut ? "#948C84" : "#fff",
                border: `1px solid ${soldOut ? "#3a332c" : "#A16207"}`,
                cursor: soldOut ? "not-allowed" : "pointer",
              }}
            >
              {soldOut ? "No slots left this week" : "Schedule a Site Visit"}
            </button>
            <button
              className="nv-btn-dark-outline"
              onClick={() => s.openModal("phonecall", property)}
              style={{ ...actionButton, background: "transparent", color: "#F5F0E8", border: "1px solid #4a423b" }}
            >
              Schedule a Call with Owner
            </button>
            <button
              className="nv-btn-bone"
              onClick={() => s.openModal("message", property)}
              style={{ ...actionButton, background: "transparent", color: "#F5F0E8", border: "1px solid #4a423b" }}
            >
              Leave a Message
            </button>
            <button
              className="nv-btn-ghost-dark"
              onClick={() => s.toggleSave(property.slug)}
              aria-pressed={saved}
              style={{
                ...actionButton,
                marginBottom: 0,
                background: "transparent",
                color: "#F5F0E8",
                border: "1px solid #4a423b",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 9,
              }}
            >
              <Heart filled={saved} stroke="#F5F0E8" size={16} />
              {saved ? "Saved" : "Save this property"}
            </button>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
              <button
                className="nv-btn-ghost-dark"
                onClick={() => {
                  const ok = downloadBrochure(property);
                  s.showToast(
                    ok
                      ? "Brochure downloaded — open it to view, or print to PDF."
                      : "Could not generate the brochure here — try again in the app.",
                  );
                }}
                style={smallAction}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 3v12M8 11l4 4 4-4M5 21h14" />
                </svg>
                Brochure
              </button>
              <button className="nv-btn-wa-ghost" onClick={() => shareOnWhatsApp(property)} style={smallAction}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                  <path d="M12 2a10 10 0 00-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1012 2zm5.6 14.2c-.2.6-1.2 1.2-1.7 1.2-.4 0-1 .1-3.2-.9-2.7-1.2-4.4-4-4.5-4.2-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.4.6c-.2.2-.3.4-.1.7.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.2.1.4.1.6-.1l.7-.9c.2-.2.3-.2.6-.1l1.9.9c.3.1.4.2.5.3.1.3.1.9-.1 1.5z" />
                </svg>
                Share
              </button>
            </div>

            <p
              style={{
                marginTop: 24,
                paddingTop: 22,
                borderTop: "1px solid #2e2825",
                fontSize: "0.85rem",
                color: "#C0BAB2",
                fontWeight: 300,
              }}
            >
              Listed and managed directly by the owner. Your enquiry reaches them — no middlemen, no
              brokerage.
            </p>
          </aside>
        </div>

        {/* ------------------------------------------------------- similar */}
        {s.similar.length > 0 && (
          <section style={{ paddingBottom: 80 }}>
            <DarkEyebrow>You may also like</DarkEyebrow>
            <h2 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.7rem", margin: "8px 0 26px", color: "#F5F0E8" }}>
              Other curated homes
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 28 }}>
              {s.similar.map((p) => (
                <Reveal
                  key={p.slug}
                  as="article"
                  className="nv-card-sm"
                  onClick={() => s.goToProperty(p.slug)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      s.goToProperty(p.slug);
                    }
                  }}
                  style={{
                    background: "#1F1B18",
                    border: "1px solid #2e2825",
                    borderRadius: 6,
                    overflow: "hidden",
                    cursor: "pointer",
                  }}
                >
                  <div data-skel style={{ aspectRatio: "4 / 3", overflow: "hidden", background: "#1C1917" }}>
                    <Photo
                      src={p.heroImageUrl}
                      fallback={svgUri(propertyPlaceholder(p.name))}
                      alt={`${p.name} exterior`}
                      loading="lazy"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        filter: "saturate(1.05) contrast(1.03)",
                      }}
                    />
                  </div>
                  <div style={{ padding: 22 }}>
                    <h3 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.1rem", margin: "0 0 4px", color: "#F5F0E8" }}>
                      {p.name}
                    </h3>
                    <p style={{ color: "#948C84", fontSize: "0.84rem", margin: 0 }}>{p.location}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
