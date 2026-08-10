"use client";

import type { PropertyDto } from "@/lib/dto";
import { propertyPlaceholder, svgUri } from "@/lib/graphics";

import { useNivasa } from "./nivasa-store";
import { AvailabilityDot, Heart, Photo, Reveal, SERIF } from "./ui";

const chip: React.CSSProperties = {
  fontSize: "0.72rem",
  letterSpacing: "0.04em",
  color: "#57534E",
  border: "1px solid #E4DCD0",
  padding: "4px 10px",
  borderRadius: 20,
};

export function PropertyCard({ property }: { property: PropertyDto }) {
  const s = useNivasa();
  const saved = s.isSaved(property.slug);
  const avail = property.availability;
  const fallback = svgUri(propertyPlaceholder(property.name));

  return (
    <Reveal
      as="article"
      className="nv-card"
      style={{
        background: "#fff",
        border: "1px solid #ECE5DB",
        borderRadius: 6,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        boxShadow: "0 1px 2px rgba(28,25,23,0.04)",
      }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          s.toggleSave(property.slug);
        }}
        aria-label={saved ? `Remove ${property.name} from your shortlist` : `Save ${property.name}`}
        aria-pressed={saved}
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          zIndex: 5,
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: "rgba(28,25,23,0.5)",
          backdropFilter: "blur(4px)",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <Heart filled={saved} stroke="#ffffff" />
      </button>

      <span
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          zIndex: 5,
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 12px 6px 10px",
          background: "rgba(250,247,242,0.92)",
          backdropFilter: "blur(4px)",
          borderRadius: 20,
          fontSize: "0.68rem",
          letterSpacing: "0.05em",
          color: "#57534E",
          pointerEvents: "none",
          boxShadow: "0 2px 8px -4px rgba(28,25,23,0.4)",
        }}
      >
        <AvailabilityDot colour={avail.dot} />
        {avail.label}
      </span>

      <button
        data-skel
        onClick={() => s.goToProperty(property.slug)}
        aria-label={`View ${property.name}`}
        style={{
          border: "none",
          padding: 0,
          background: "#1C1917",
          cursor: "pointer",
          aspectRatio: "4 / 3",
          overflow: "hidden",
          display: "block",
        }}
      >
        <Photo
          src={property.heroImageUrl}
          fallback={fallback}
          alt={`${property.name} exterior`}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "saturate(1.05) contrast(1.03)",
          }}
        />
      </button>

      <div style={{ padding: "26px 26px 28px", display: "flex", flexDirection: "column", flex: 1 }}>
        <p
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            color: "#A16207",
            fontSize: "0.9rem",
            letterSpacing: "0.01em",
            margin: "0 0 12px",
          }}
        >
          {property.tagline}
        </p>
        <h3
          style={{
            fontFamily: SERIF,
            fontWeight: 600,
            fontSize: "1.32rem",
            margin: "0 0 4px",
            color: "#1C1917",
          }}
        >
          {property.name}
        </h3>
        <p style={{ color: "#78716C", fontSize: "0.85rem", margin: "0 0 16px" }}>
          {property.location}
        </p>
        <p
          style={{
            color: "#57534E",
            fontSize: "0.92rem",
            fontWeight: 300,
            margin: "0 0 20px",
            flex: 1,
          }}
        >
          {property.story}
        </p>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18 }}>
          <span style={{ display: "flex", gap: 8 }}>
            <span style={chip}>{property.bhk}</span>
            <span style={chip}>{property.area}</span>
          </span>
        </div>
        <button
          className="nv-btn-outline"
          onClick={() => s.goToProperty(property.slug)}
          style={{
            padding: 13,
            background: "transparent",
            color: "#1C1917",
            border: "1px solid #1C1917",
            borderRadius: 2,
            cursor: "pointer",
            fontSize: "0.76rem",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontFamily: "inherit",
          }}
        >
          View this home
        </button>
      </div>
    </Reveal>
  );
}
