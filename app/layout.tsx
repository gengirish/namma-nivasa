import type { Metadata, Viewport } from "next";
import { Cinzel, Josefin_Sans } from "next/font/google";

import { ServiceWorkerRegistrar } from "@/components/service-worker";
import "./globals.css";

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-cinzel",
  display: "swap",
});

const josefin = Josefin_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-josefin",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nivasa — Curated Homes in Bangalore",
  description:
    "A small, deliberate collection of premium Bangalore residences — each one personally visited, verified and photographed. No feeds, no brokers, no noise.",
  manifest: "/manifest.webmanifest",
  applicationName: "Nivasa",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "Nivasa", statusBarStyle: "default" },
  openGraph: {
    title: "Nivasa — Curated Homes in Bangalore",
    description:
      "Hand-picked Bangalore homes, personally verified. Direct owner contact, zero brokerage.",
    locale: "en_IN",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#1C1917",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${cinzel.variable} ${josefin.variable}`}>
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
