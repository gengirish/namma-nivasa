"use client";

import { useEffect, useRef } from "react";

import { useNivasa } from "./nivasa-store";
import { imagePlaceholder, svgUri } from "@/lib/graphics";
import { Photo } from "./ui";

const roundButton: React.CSSProperties = {
  background: "rgba(255,255,255,0.12)",
  border: "none",
  color: "#fff",
  width: 44,
  height: 44,
  borderRadius: "50%",
  cursor: "pointer",
  fontSize: "1.3rem",
};

export function Lightbox() {
  const s = useNivasa();
  if (!s.lightboxOpen) return null;

  const image = s.gallery[s.lightboxIndex] ?? s.gallery[0];
  if (!image) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) s.closeLightbox();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(12,10,9,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 250,
      }}
    >
      <div style={{ maxWidth: 900, width: "100%", position: "relative" }}>
        <button onClick={s.closeLightbox} aria-label="Close" style={{ ...roundButton, position: "absolute", top: -52, right: 0 }}>
          ×
        </button>
        <button
          onClick={() => s.stepLightbox(-1)}
          aria-label="Previous image"
          style={{ ...roundButton, position: "absolute", left: -58, top: "50%", transform: "translateY(-50%)" }}
        >
          ‹
        </button>
        <button
          onClick={() => s.stepLightbox(1)}
          aria-label="Next image"
          style={{ ...roundButton, position: "absolute", right: -58, top: "50%", transform: "translateY(-50%)" }}
        >
          ›
        </button>
        <Photo
          src={image.url}
          fallback={svgUri(imagePlaceholder(image.alt))}
          alt={image.alt}
          style={{
            width: "100%",
            borderRadius: 4,
            maxHeight: "78vh",
            objectFit: "contain",
            background: "#1C1917",
          }}
        />
        <p style={{ color: "#B7B2AC", fontSize: "0.75rem", textAlign: "center", marginTop: 12 }}>
          {image.alt} · Photo via Pexels
        </p>
      </div>
    </div>
  );
}

export function VideoModal() {
  const s = useNivasa();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!s.videoOpen) return;
    const t = setTimeout(() => {
      videoRef.current?.play().catch(() => {
        /* autoplay may be blocked — the controls are right there */
      });
    }, 60);
    return () => clearTimeout(t);
  }, [s.videoOpen]);

  if (!s.videoOpen || !s.property?.videoUrl) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) s.closeVideo();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${s.property.name} video tour`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(12,10,9,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 250,
      }}
    >
      <div style={{ maxWidth: 960, width: "100%", position: "relative" }}>
        <button onClick={s.closeVideo} aria-label="Close" style={{ ...roundButton, position: "absolute", top: -52, right: 0 }}>
          ×
        </button>
        <video
          ref={videoRef}
          src={s.property.videoUrl}
          poster={s.property.heroImageUrl}
          controls
          playsInline
          preload="metadata"
          style={{ width: "100%", borderRadius: 5, maxHeight: "80vh", background: "#1C1917", display: "block" }}
        />
        <p style={{ color: "#B7B2AC", fontSize: "0.75rem", textAlign: "center", marginTop: 12 }}>
          Walkthrough of {s.property.name}
        </p>
      </div>
    </div>
  );
}

export function Toast() {
  const s = useNivasa();
  return (
    <div aria-live="polite" role="status">
      {s.toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1C1917",
            color: "#fff",
            padding: "14px 26px",
            borderRadius: 3,
            fontSize: "0.85rem",
            letterSpacing: "0.02em",
            zIndex: 300,
            maxWidth: "90vw",
            textAlign: "center",
            animation: "nvfade .26s ease",
            boxShadow: "0 16px 40px -16px rgba(0,0,0,0.5)",
          }}
        >
          {s.toast}
        </div>
      )}
    </div>
  );
}

export function BackToTop() {
  const s = useNivasa();
  if (!s.showBackTop) return null;

  return (
    <button
      onClick={s.backToTop}
      aria-label="Back to top"
      style={{
        position: "fixed",
        bottom: 92,
        right: 24,
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "#1C1917",
        color: "#fff",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        zIndex: 60,
        boxShadow: "0 12px 28px -10px rgba(0,0,0,0.4)",
      }}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
