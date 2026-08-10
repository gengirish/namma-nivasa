"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { EnquiryReceiptDto, GalleryImageDto, PropertyDto } from "@/lib/dto";
import { recentStore, savedStore } from "@/lib/persisted-ids";
import type { ModalMode, ViewName } from "@/lib/types";

const RECENT_LIMIT = 6;

/** The gallery is the hero followed by whatever the curator uploaded. */
function galleryFor(property: PropertyDto): GalleryImageDto[] {
  return [{ url: property.heroImageUrl, alt: `${property.name} exterior` }, ...property.images];
}

export interface EnquiryFields {
  name: string;
  phone: string;
  email?: string;
  message?: string;
}

export interface NivasaStore {
  /* catalogue */
  properties: PropertyDto[];

  /* navigation */
  view: ViewName;
  property: PropertyDto | undefined;
  goHome: () => void;
  goToProperty: (slug: string) => void;
  openMap: () => void;
  openList: () => void;
  scrollToSection: (id: string) => void;
  exploreScroll: () => void;
  howScroll: () => void;
  faqScroll: () => void;

  /* listings */
  filter: string;
  setFilter: (value: string) => void;
  viewingSaved: boolean;
  displayed: PropertyDto[];
  similar: PropertyDto[];
  recent: PropertyDto[];
  clearRecent: () => void;

  /* shortlist */
  savedCount: number;
  isSaved: (slug: string) => boolean;
  toggleSave: (slug: string) => void;
  viewSaved: () => void;

  /* header */
  mobileMenu: boolean;
  toggleMenu: () => void;
  closeMenu: () => void;

  /* enquiry modal */
  modalOpen: boolean;
  modalMode: ModalMode;
  /** The listing the modal is about, or null for a general enquiry. */
  modalProperty: PropertyDto | null;
  modalHeading: string;
  selDate: string;
  selTime: string | null;
  submitting: boolean;
  receipt: EnquiryReceiptDto | null;
  openModal: (mode: ModalMode, property: PropertyDto | null) => void;
  closeModal: () => void;
  setSelDate: (value: string) => void;
  setSelTime: (value: string) => void;
  submitEnquiry: (fields: EnquiryFields) => Promise<void>;

  /* gallery + video */
  gallery: GalleryImageDto[];
  lightboxOpen: boolean;
  lightboxIndex: number;
  openLightbox: (index: number) => void;
  closeLightbox: () => void;
  stepLightbox: (direction: number) => void;
  videoOpen: boolean;
  openVideo: () => void;
  closeVideo: () => void;

  /* chrome */
  faqOpen: number | null;
  toggleFaq: (index: number) => void;
  toast: string;
  showToast: (message: string) => void;
  showBackTop: boolean;
  backToTop: () => void;
}

const NivasaContext = createContext<NivasaStore | null>(null);

export function useNivasa(): NivasaStore {
  const store = useContext(NivasaContext);
  if (!store) throw new Error("useNivasa must be used inside <NivasaProvider>");
  return store;
}

export function NivasaProvider({
  properties,
  children,
}: {
  properties: PropertyDto[];
  children: ReactNode;
}) {
  const [view, setView] = useState<ViewName>("home");
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const savedSlugs = useSyncExternalStore(
    savedStore.subscribe,
    savedStore.getSnapshot,
    savedStore.getServerSnapshot,
  );
  const recentSlugs = useSyncExternalStore(
    recentStore.subscribe,
    recentStore.getSnapshot,
    recentStore.getServerSnapshot,
  );
  const [filter, setFilterState] = useState("all");
  const [viewingSaved, setViewingSaved] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("call");
  const [modalProperty, setModalProperty] = useState<PropertyDto | null>(null);
  const [selDate, setSelDate] = useState("");
  const [selTime, setSelTime] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<EnquiryReceiptDto | null>(null);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [videoOpen, setVideoOpen] = useState(false);

  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [showBackTop, setShowBackTop] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------------------------------------ selectors */

  const bySlug = useMemo(
    () => new Map(properties.map((p) => [p.slug, p])),
    [properties],
  );

  const property = currentSlug ? bySlug.get(currentSlug) : undefined;
  const savedSet = useMemo(() => new Set(savedSlugs), [savedSlugs]);

  const displayed = useMemo(() => {
    let list = properties.filter((p) => filter === "all" || p.bhkNum === Number(filter));
    if (viewingSaved) list = list.filter((p) => savedSet.has(p.slug));
    return list;
  }, [properties, filter, viewingSaved, savedSet]);

  const similar = useMemo(
    () => (property ? properties.filter((p) => p.slug !== property.slug) : []),
    [properties, property],
  );

  /** A slug that no longer resolves is a home that was archived while it sat in storage. */
  const recent = useMemo(
    () => recentSlugs.map((slug) => bySlug.get(slug)).filter((p): p is PropertyDto => !!p),
    [recentSlugs, bySlug],
  );

  const gallery = useMemo(() => (property ? galleryFor(property) : []), [property]);

  /* -------------------------------------------------------------- actions */

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3600);
  }, []);

  const goHome = useCallback(() => {
    setView("home");
    setViewingSaved(false);
    setMobileMenu(false);
    window.scrollTo({ top: 0 });
  }, []);

  const goToProperty = useCallback((slug: string) => {
    const prev = recentStore.getSnapshot();
    recentStore.set([slug, ...prev.filter((x) => x !== slug)].slice(0, RECENT_LIMIT));
    setCurrentSlug(slug);
    setView("property");
    setMobileMenu(false);
    window.scrollTo({ top: 0 });
  }, []);

  const openMap = useCallback(() => {
    setView("map");
    setViewingSaved(false);
    setMobileMenu(false);
    window.scrollTo({ top: 0 });
  }, []);

  const openList = useCallback(() => {
    setView("list");
    setViewingSaved(false);
    setMobileMenu(false);
    window.scrollTo({ top: 0 });
  }, []);

  const scrollToSection = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const goToSection = useCallback(
    (id: string, clearSaved: boolean) => {
      setMobileMenu(false);
      if (view !== "home") {
        setView("home");
        if (clearSaved) setViewingSaved(false);
        setTimeout(() => scrollToSection(id), 60);
      } else {
        scrollToSection(id);
      }
    },
    [view, scrollToSection],
  );

  const exploreScroll = useCallback(() => goToSection("nv-listings", true), [goToSection]);
  const howScroll = useCallback(() => goToSection("nv-how", false), [goToSection]);
  const faqScroll = useCallback(() => goToSection("nv-faq", false), [goToSection]);

  const setFilter = useCallback((value: string) => setFilterState(value), []);

  const isSaved = useCallback((slug: string) => savedSet.has(slug), [savedSet]);

  const toggleSave = useCallback((slug: string) => {
    const prev = savedStore.getSnapshot();
    savedStore.set(prev.includes(slug) ? prev.filter((x) => x !== slug) : [...prev, slug]);
  }, []);

  const viewSaved = useCallback(() => {
    setView("home");
    setViewingSaved(true);
    setFilterState("all");
    setMobileMenu(false);
    setTimeout(() => scrollToSection("nv-listings"), 60);
    if (savedSlugs.length === 0) {
      showToast("Nothing saved yet — tap the heart on any home to shortlist it.");
    }
  }, [savedSlugs.length, scrollToSection, showToast]);

  const clearRecent = useCallback(() => recentStore.set([]), []);

  const openModal = useCallback((mode: ModalMode, target: PropertyDto | null) => {
    setModalMode(mode);
    setModalProperty(target);
    setSelDate("");
    setSelTime(null);
    setReceipt(null);
    setSubmitting(false);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setReceipt(null);
  }, []);

  /**
   * Posts the enquiry and keeps whatever the server says. The reference, the confirmed slot and
   * the refusal ("someone just took that slot") are all decided server-side — the client never
   * invents a confirmation for something the database did not accept.
   */
  const submitEnquiry = useCallback(
    async (fields: EnquiryFields) => {
      const kind =
        modalMode === "call" ? "SITE_VISIT" : modalMode === "phonecall" ? "OWNER_CALL" : "MESSAGE";
      const body = {
        kind: modalProperty ? kind : "GENERAL",
        propertySlug: modalProperty?.slug ?? null,
        name: fields.name,
        phone: fields.phone,
        email: fields.email || null,
        message: fields.message || null,
        date: selDate || null,
        time: selTime,
      };

      setSubmitting(true);
      try {
        const res = await fetch("/api/enquiries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await res.json().catch(() => null)) as
          | { success: true; data: EnquiryReceiptDto }
          | { success: false; error: string }
          | null;

        if (!res.ok || !payload?.success) {
          showToast(payload && !payload.success ? payload.error : "Could not send that — try again");
          return;
        }
        setReceipt(payload.data);
      } catch {
        showToast("Could not reach the server — check your connection and try again");
      } finally {
        setSubmitting(false);
      }
    },
    [modalMode, modalProperty, selDate, selTime, showToast],
  );

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);
  const stepLightbox = useCallback(
    (direction: number) => {
      const n = gallery.length || 1;
      setLightboxIndex((i) => (i + direction + n) % n);
    },
    [gallery.length],
  );

  const openVideo = useCallback(() => setVideoOpen(true), []);
  const closeVideo = useCallback(() => setVideoOpen(false), []);

  const toggleFaq = useCallback(
    (index: number) => setFaqOpen((cur) => (cur === index ? null : index)),
    [],
  );

  const backToTop = useCallback(() => window.scrollTo({ top: 0, behavior: "smooth" }), []);

  /* --------------------------------------------------------- side effects */

  useEffect(() => {
    const onScroll = () => setShowBackTop((window.scrollY || 0) > 520);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModalOpen(false);
        setReceipt(null);
        setLightboxOpen(false);
        setMobileMenu(false);
        setVideoOpen(false);
      }
      if (lightboxOpen && e.key === "ArrowRight") stepLightbox(1);
      if (lightboxOpen && e.key === "ArrowLeft") stepLightbox(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightboxOpen, stepLightbox]);

  /* Lock the page behind any overlay. */
  useEffect(() => {
    const lock = modalOpen || lightboxOpen || videoOpen;
    document.body.style.overflow = lock ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [modalOpen, lightboxOpen, videoOpen]);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const modalHeading = modalProperty?.name ?? "Nivasa — General Enquiry";

  const store = useMemo<NivasaStore>(
    () => ({
      properties,
      view,
      property,
      goHome,
      goToProperty,
      openMap,
      openList,
      scrollToSection,
      exploreScroll,
      howScroll,
      faqScroll,
      filter,
      setFilter,
      viewingSaved,
      displayed,
      similar,
      recent,
      clearRecent,
      savedCount: savedSlugs.length,
      isSaved,
      toggleSave,
      viewSaved,
      mobileMenu,
      toggleMenu: () => setMobileMenu((m) => !m),
      closeMenu: () => setMobileMenu(false),
      modalOpen,
      modalMode,
      modalProperty,
      modalHeading,
      selDate,
      selTime,
      submitting,
      receipt,
      openModal,
      closeModal,
      setSelDate,
      setSelTime,
      submitEnquiry,
      gallery,
      lightboxOpen,
      lightboxIndex,
      openLightbox,
      closeLightbox,
      stepLightbox,
      videoOpen,
      openVideo,
      closeVideo,
      faqOpen,
      toggleFaq,
      toast,
      showToast,
      showBackTop,
      backToTop,
    }),
    [
      properties,
      view,
      property,
      goHome,
      goToProperty,
      openMap,
      openList,
      scrollToSection,
      exploreScroll,
      howScroll,
      faqScroll,
      filter,
      setFilter,
      viewingSaved,
      displayed,
      similar,
      recent,
      clearRecent,
      savedSlugs.length,
      isSaved,
      toggleSave,
      viewSaved,
      mobileMenu,
      modalOpen,
      modalMode,
      modalProperty,
      modalHeading,
      selDate,
      selTime,
      submitting,
      receipt,
      openModal,
      closeModal,
      submitEnquiry,
      gallery,
      lightboxOpen,
      lightboxIndex,
      openLightbox,
      closeLightbox,
      stepLightbox,
      videoOpen,
      openVideo,
      closeVideo,
      faqOpen,
      toggleFaq,
      toast,
      showToast,
      showBackTop,
      backToTop,
    ],
  );

  return <NivasaContext.Provider value={store}>{children}</NivasaContext.Provider>;
}
