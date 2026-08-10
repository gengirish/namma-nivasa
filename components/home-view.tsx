"use client";

import { useState, type FormEvent } from "react";

import { FAQS, STEPS, TESTIMONIALS } from "@/lib/content";
import { propertyPlaceholder, svgUri } from "@/lib/graphics";

import { useNivasa } from "./nivasa-store";
import { PropertyCard } from "./property-card";
import { Eyebrow, Photo, Reveal, SectionHeading, SERIF } from "./ui";

const TRUST = [
  {
    label: "Every listing verified",
    path: (
      <>
        <path d="M9 12l2 2 4-4" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
  },
  {
    label: "Direct owner contact",
    path: (
      <>
        <path d="M4 21v-8a2 2 0 012-2h12a2 2 0 012 2v8" />
        <path d="M9 21v-6h6v6" />
        <path d="M4 13L12 4l8 9" />
      </>
    ),
  },
  {
    label: "Zero brokerage, ever",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </>
    ),
  },
  {
    label: "RERA registered*",
    path: <path d="M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7z" />,
  },
];

export function HomeView() {
  const s = useNivasa();
  const [email, setEmail] = useState("");
  const [subscribing, setSubscribing] = useState(false);

  const onNewsletter = async (e: FormEvent) => {
    e.preventDefault();
    if (subscribing) return;
    setSubscribing(true);
    try {
      const res = await fetch("/api/subscribers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { success: false; error: string }
        | { success: true }
        | null;
      if (!res.ok || !payload?.success) {
        s.showToast(payload && !payload.success ? payload.error : "Could not sign you up — try again");
        return;
      }
      setEmail("");
      s.showToast("Thanks — we'll reach out when the next home is curated.");
    } catch {
      s.showToast("Could not reach the server — check your connection and try again");
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <main>
      {/* ------------------------------------------------------------- hero */}
      <section
        data-hero
        style={{
          position: "relative",
          padding: "96px 24px 80px",
          textAlign: "center",
          background: "linear-gradient(180deg,#FFFFFF 0%,#FAF7F2 100%)",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none" }} aria-hidden="true">
          <svg viewBox="0 0 1400 460" preserveAspectRatio="xMidYMax slice" style={{ width: "100%", height: "100%" }}>
            <g stroke="#C99A3F" strokeWidth="1.2" fill="none" opacity="0.55">
              <rect x="80" y="240" width="90" height="220" />
              <rect x="190" y="170" width="70" height="290" />
              <rect x="280" y="215" width="100" height="245" />
              <rect x="1010" y="185" width="80" height="275" />
              <rect x="1110" y="240" width="90" height="220" />
              <rect x="1215" y="150" width="70" height="310" />
            </g>
          </svg>
        </div>

        <div
          style={{
            position: "relative",
            maxWidth: 820,
            margin: "0 auto",
            animation: "nvfade .9s ease both",
          }}
        >
          <p
            style={{
              fontSize: "0.72rem",
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "#A16207",
              fontWeight: 600,
            }}
          >
            Curated · Hand-picked · Bangalore
          </p>
          <h1
            style={{
              fontFamily: SERIF,
              fontWeight: 600,
              fontSize: "clamp(2.7rem,6.2vw,4.7rem)",
              lineHeight: 1.05,
              margin: "18px 0",
              color: "#1C1917",
            }}
          >
            Find a home
            <br />
            worth coming back to.
          </h1>
          <p
            style={{
              maxWidth: 580,
              margin: "0 auto 34px",
              color: "#57534E",
              fontSize: "1.1rem",
              fontWeight: 300,
            }}
          >
            A small, deliberate collection of premium Bangalore residences — each one personally
            visited, verified and photographed before it ever reaches you. No feeds. No brokers. No
            noise.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <button
              className="nv-btn-gold"
              onClick={() => s.openModal("message", null)}
              style={{
                padding: "16px 36px",
                background: "#A16207",
                color: "#fff",
                border: "1px solid #A16207",
                borderRadius: 2,
                cursor: "pointer",
                fontSize: "0.82rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontFamily: "inherit",
              }}
            >
              Talk to us
            </button>
            <button
              className="nv-btn-outline"
              onClick={s.exploreScroll}
              style={{
                padding: "16px 36px",
                background: "transparent",
                color: "#1C1917",
                border: "1px solid #1C1917",
                borderRadius: 2,
                cursor: "pointer",
                fontSize: "0.82rem",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontFamily: "inherit",
              }}
            >
              Explore Homes
            </button>
          </div>
          <div style={{ marginTop: 48, display: "flex", justifyContent: "center" }}>
            <svg
              viewBox="0 0 24 24"
              width="26"
              height="26"
              fill="none"
              stroke="#C99A3F"
              strokeWidth="1.6"
              style={{ animation: "nvbounce 2.2s ease-in-out infinite" }}
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ trust strip */}
      <section style={{ background: "#fff", borderTop: "1px solid #ECE5DB", borderBottom: "1px solid #ECE5DB" }}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "26px 24px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 24,
          }}
        >
          {TRUST.map((t) => (
            <div
              key={t.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                gap: 10,
                fontSize: "0.78rem",
                color: "#57534E",
                letterSpacing: "0.02em",
              }}
            >
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#A16207" strokeWidth="1.6" aria-hidden="true">
                {t.path}
              </svg>
              {t.label}
            </div>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- listings */}
      <section id="nv-listings" style={{ padding: "78px 24px 40px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <Eyebrow>{s.viewingSaved ? "Your Shortlist" : "Featured Residences"}</Eyebrow>
            <SectionHeading>
              {s.viewingSaved ? "Your saved homes" : "A few homes, chosen with care"}
            </SectionHeading>
          </div>

          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 44 }}>
            <select
              value={s.filter}
              onChange={(e) => s.setFilter(e.target.value)}
              aria-label="Filter by configuration"
              style={{
                padding: "11px 18px",
                border: "1px solid #DDD5C9",
                borderRadius: 2,
                background: "#fff",
                fontFamily: "inherit",
                fontSize: "0.85rem",
                letterSpacing: "0.03em",
                cursor: "pointer",
                color: "#1C1917",
              }}
            >
              <option value="all">All configurations</option>
              <option value="2">2 BHK</option>
              <option value="3">3 BHK</option>
              <option value="4">4 BHK</option>
            </select>
          </div>

          {s.displayed.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 36 }}>
              {s.displayed.map((p) => (
                <PropertyCard key={p.slug} property={p} />
              ))}
            </div>
          ) : (
            <p style={{ textAlign: "center", color: "#78716C", padding: "64px 0", fontSize: "0.98rem" }}>
              {s.viewingSaved
                ? "You haven't saved any homes yet — tap the heart on a listing to shortlist it."
                : s.properties.length === 0
                  ? "No homes are published just yet — the next one is being visited and written up."
                  : 'No homes match that filter right now — try "All configurations".'}
            </p>
          )}
        </div>
      </section>

      {/* --------------------------------------------------- recently viewed */}
      {s.recent.length > 0 && (
        <section style={{ padding: "6px 24px 78px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 16,
                marginBottom: 26,
              }}
            >
              <div>
                <Eyebrow>Pick up where you left off</Eyebrow>
                <SectionHeading style={{ fontSize: "clamp(1.6rem,3vw,2.1rem)", margin: "8px 0 0" }}>
                  Recently viewed
                </SectionHeading>
              </div>
              <button
                className="nv-textlink"
                onClick={s.clearRecent}
                style={{
                  background: "none",
                  border: "none",
                  color: "#78716C",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "0.76rem",
                  letterSpacing: "0.06em",
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                Clear
              </button>
            </div>

            <div
              data-recentrow
              style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 20 }}
            >
              {s.recent.map((p) => (
                <Reveal
                  key={p.slug}
                  as="button"
                  className="nv-card-sm"
                  onClick={() => s.goToProperty(p.slug)}
                  style={{
                    textAlign: "left",
                    background: "#fff",
                    border: "1px solid #ECE5DB",
                    borderRadius: 6,
                    overflow: "hidden",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div data-skel style={{ aspectRatio: "16 / 10", overflow: "hidden", background: "#1C1917", width: "100%" }}>
                    <Photo
                      src={p.heroImageUrl}
                      fallback={svgUri(propertyPlaceholder(p.name))}
                      alt={p.name}
                      loading="lazy"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        filter: "saturate(1.05) contrast(1.03)",
                      }}
                    />
                  </div>
                  <div style={{ padding: "16px 18px 18px" }}>
                    <p style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1rem", margin: "0 0 3px", color: "#1C1917" }}>
                      {p.name}
                    </p>
                    <p style={{ color: "#78716C", fontSize: "0.8rem", margin: 0 }}>{p.location}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------- how it works */}
      <section id="nv-how" style={{ padding: "78px 24px", background: "#1C1917", color: "#fff" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 52 }}>
            <Eyebrow tone="goldLight">The Nivasa Way</Eyebrow>
            <SectionHeading style={{ color: "#fff" }}>How a home reaches you</SectionHeading>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 40 }}>
            {STEPS.map((step) => (
              <Reveal key={step.n} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: SERIF, fontSize: "2.4rem", color: "#C99A3F" }}>{step.n}</div>
                <h3
                  style={{
                    fontFamily: SERIF,
                    fontWeight: 500,
                    fontSize: "1.2rem",
                    margin: "12px 0 8px",
                    color: "#fff",
                  }}
                >
                  {step.title}
                </h3>
                <p style={{ color: "#B7B2AC", fontSize: "0.9rem", fontWeight: 300 }}>{step.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ founder note */}
      <section style={{ padding: "20px 24px 78px" }}>
        <div
          style={{
            maxWidth: 820,
            margin: "0 auto",
            background: "#F3ECE1",
            borderRadius: 10,
            padding: "56px 48px",
            textAlign: "center",
          }}
        >
          <Eyebrow>A note from us</Eyebrow>
          <p
            style={{
              fontFamily: SERIF,
              fontSize: "clamp(1.3rem,2.6vw,1.7rem)",
              lineHeight: 1.5,
              color: "#1C1917",
              margin: "20px 0 22px",
            }}
          >
            &ldquo;We started Nivasa because buying a home in this city had become noisy,
            transactional and full of middlemen. So we slowed it down — a handful of genuine homes,
            seen with our own eyes, offered honestly to whoever they suit best.&rdquo;
          </p>
          <p style={{ color: "#57534E", fontSize: "0.9rem" }}>— The Nivasa team, Bangalore</p>
        </div>
      </section>

      {/* -------------------------------------------------------- newsletter */}
      <section style={{ padding: "0 24px 78px" }}>
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            background: "#1C1917",
            borderRadius: 10,
            padding: "52px 40px",
            textAlign: "center",
          }}
        >
          <h3 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.5rem", color: "#fff", margin: "0 0 8px" }}>
            Notified before anyone else
          </h3>
          <p style={{ color: "#B7B2AC", fontSize: "0.92rem", fontWeight: 300, margin: "0 0 26px" }}>
            New homes are rare and go fast. Leave your email and we&apos;ll reach out the moment the
            next one is curated.
          </p>
          <form onSubmit={onNewsletter} style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              aria-label="Email address"
              style={{
                padding: "14px 18px",
                border: "1px solid #3a3532",
                background: "#26221f",
                color: "#fff",
                borderRadius: 2,
                fontFamily: "inherit",
                minWidth: 260,
                fontSize: "0.95rem",
              }}
            />
            <button
              type="submit"
              disabled={subscribing}
              className="nv-btn-gold-bright"
              style={{
                padding: "14px 30px",
                background: "#A16207",
                color: "#fff",
                border: "1px solid #A16207",
                borderRadius: 2,
                cursor: subscribing ? "progress" : "pointer",
                opacity: subscribing ? 0.7 : 1,
                fontSize: "0.8rem",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                fontFamily: "inherit",
              }}
            >
              {subscribing ? "Signing you up…" : "Notify Me"}
            </button>
          </form>
        </div>
      </section>

      {/* ------------------------------------------------------ testimonials */}
      <section style={{ padding: "0 24px 78px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 44 }}>
            <Eyebrow>Word of Mouth</Eyebrow>
            <SectionHeading>What buyers say</SectionHeading>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 26 }}>
            {TESTIMONIALS.map((t) => (
              <Reveal
                key={t.who}
                style={{
                  background: "#fff",
                  border: "1px solid #ECE5DB",
                  borderRadius: 6,
                  padding: 28,
                  fontSize: "0.92rem",
                  color: "#57534E",
                  fontWeight: 300,
                }}
              >
                <div style={{ color: "#A16207", letterSpacing: 2, marginBottom: 14 }}>★★★★★</div>
                &ldquo;{t.quote}&rdquo;
                <div style={{ fontFamily: SERIF, color: "#1C1917", fontSize: "0.9rem", marginTop: 18 }}>
                  — {t.who}
                </div>
              </Reveal>
            ))}
          </div>
          <p style={{ textAlign: "center", fontSize: "0.7rem", color: "#A8A29E", marginTop: 22 }}>
            Sample placeholder quotes — replace with real, consented reviews before launch.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------- owner CTA */}
      <section style={{ padding: "0 24px 78px" }}>
        <div
          style={{
            maxWidth: 900,
            margin: "0 auto",
            background: "#F3ECE1",
            borderRadius: 10,
            padding: "44px 40px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 240 }}>
            <Eyebrow>For Owners</Eyebrow>
            <h3 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.5rem", margin: "8px 0 6px", color: "#1C1917" }}>
              Own a home worth featuring?
            </h3>
            <p style={{ color: "#57534E", fontSize: "0.94rem", fontWeight: 300, margin: 0 }}>
              We take on only a handful at a time. Tell us about yours.
            </p>
          </div>
          <button
            className="nv-btn-dark"
            onClick={s.openList}
            style={{
              padding: "16px 32px",
              background: "#1C1917",
              color: "#fff",
              border: "1px solid #1C1917",
              borderRadius: 2,
              cursor: "pointer",
              fontSize: "0.8rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            List your home
          </button>
        </div>
      </section>

      {/* --------------------------------------------------------------- faq */}
      <section id="nv-faq" style={{ padding: "78px 24px", background: "#fff", borderTop: "1px solid #ECE5DB" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <Eyebrow>Good to Know</Eyebrow>
            <SectionHeading>Frequently asked questions</SectionHeading>
          </div>
          {FAQS.map((f, i) => {
            const open = s.faqOpen === i;
            return (
              <div key={f.q} style={{ borderBottom: "1px solid #ECE5DB" }}>
                <button
                  onClick={() => s.toggleFaq(i)}
                  aria-expanded={open}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    padding: "22px 0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 16,
                    cursor: "pointer",
                    fontFamily: SERIF,
                    fontSize: "1.05rem",
                    color: "#1C1917",
                  }}
                >
                  {f.q}
                  <span
                    style={{
                      fontSize: "1.3rem",
                      color: "#A16207",
                      transform: `rotate(${open ? "45deg" : "0deg"})`,
                      transition: "transform .2s ease",
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    +
                  </span>
                </button>
                {open && (
                  <p style={{ color: "#57534E", fontSize: "0.94rem", fontWeight: 300, padding: "0 0 22px", margin: 0 }}>
                    {f.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
