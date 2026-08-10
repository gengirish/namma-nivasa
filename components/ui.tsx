"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

export const SERIF = "var(--font-serif)";
export const SANS = "var(--font-sans)";

/**
 * Listing photography is remote (Pexels) with a hand-drawn SVG standing in when a
 * URL fails, so `next/image` optimisation buys nothing here — a plain <img> with an
 * onError swap is both smaller and more predictable.
 */
export function Photo({
  src,
  fallback,
  alt,
  style,
  loading,
  className,
}: {
  src: string;
  fallback?: string;
  alt: string;
  style?: CSSProperties;
  loading?: "lazy" | "eager";
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={loading}
      className={className}
      style={style}
      onError={(e) => {
        const el = e.currentTarget;
        if (fallback && el.src !== fallback) el.src = fallback;
      }}
    />
  );
}

/**
 * Fades and lifts its child into place the first time it scrolls into view.
 * `[data-reveal]` carries the transition; the observer only adds `.nv-in`.
 */
export function Reveal({
  children,
  as: Tag = "div",
  style,
  className,
  onClick,
  role,
  tabIndex,
  onKeyDown,
}: {
  children: ReactNode;
  as?: "div" | "article" | "button";
  style?: CSSProperties;
  className?: string;
  onClick?: () => void;
  role?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("nv-in");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("nv-in");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -5% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const props = {
    ref: ref as never,
    "data-reveal": "",
    style,
    className,
    onClick,
    role,
    tabIndex,
    onKeyDown,
  };
  return <Tag {...props}>{children}</Tag>;
}

/** Small caps eyebrow above a section heading. */
export function Eyebrow({
  children,
  tone = "gold",
  style,
}: {
  children: ReactNode;
  tone?: "gold" | "goldLight";
  style?: CSSProperties;
}) {
  return (
    <p
      style={{
        fontSize: "0.72rem",
        letterSpacing: "0.28em",
        textTransform: "uppercase",
        color: tone === "gold" ? "#A16207" : "#C99A3F",
        fontWeight: 600,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </p>
  );
}

export function SectionHeading({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <h2
      style={{
        fontFamily: SERIF,
        fontWeight: 600,
        fontSize: "clamp(1.9rem,3.6vw,2.7rem)",
        margin: "10px 0 0",
        color: "#1C1917",
        ...style,
      }}
    >
      {children}
    </h2>
  );
}

export function Heart({
  filled,
  stroke,
  size = 18,
}: {
  filled: boolean;
  stroke: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "#A16207" : "none"}
      stroke={filled ? "#A16207" : stroke}
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M12 21s-7-4.35-9.5-8.5C.8 9 2 5 6 5c2 0 3.5 1.2 6 4 2.5-2.8 4-4 6-4 4 0 5.2 4 3.5 7.5C19 16.65 12 21 12 21z" />
    </svg>
  );
}

/** Pulsing availability dot used on cards and the property action card. */
export function AvailabilityDot({ colour }: { colour: string }) {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: colour,
        animation: "nvpulse 2.4s ease-in-out infinite",
        flexShrink: 0,
      }}
    />
  );
}
