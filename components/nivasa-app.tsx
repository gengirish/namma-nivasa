"use client";

import type { PropertyDto } from "@/lib/dto";

import { EnquiryModal } from "./enquiry-modal";
import { Footer } from "./footer";
import { Header } from "./header";
import { HomeView } from "./home-view";
import { ListPropertyView } from "./list-property-view";
import { MapView } from "./map-view";
import { NivasaProvider, useNivasa } from "./nivasa-store";
import { BackToTop, Lightbox, Toast, VideoModal } from "./overlays";
import { PropertyView } from "./property-view";
import { VoiceConcierge } from "./voice-concierge";

function CurrentView() {
  const s = useNivasa();

  if (s.view === "property" && s.property) return <PropertyView property={s.property} />;
  if (s.view === "map") return <MapView />;
  if (s.view === "list") return <ListPropertyView />;
  return <HomeView />;
}

/**
 * The catalogue arrives from the server component that renders this — one payload for a
 * deliberately small collection, so switching between homes costs no round trip. Availability
 * inside the booking picker is fetched live, because that is the part that changes while a
 * visitor is looking at it.
 */
export function NivasaApp({ properties }: { properties: PropertyDto[] }) {
  return (
    <NivasaProvider properties={properties}>
      <Header />
      <CurrentView />
      <Footer />
      <EnquiryModal />
      <Lightbox />
      <VideoModal />
      <Toast />
      <BackToTop />
      <VoiceConcierge />
    </NivasaProvider>
  );
}
