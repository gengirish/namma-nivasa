/** Intent routing for the demo concierge — keyword matching, entirely on-device. */

/** "Whitefield, Sarjapur Road and Indiranagar" — read aloud, so it needs the "and". */
function listLocalities(localities: string[]): string {
  const unique = [...new Set(localities)];
  if (unique.length === 1) return unique[0];
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}
export type VoiceAction = "openList" | "openMap";

export interface VoiceReply {
  text: string;
  action?: VoiceAction;
}

export function replyTo(raw: string, localities: string[] = []): VoiceReply {
  const t = (raw || "").toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));

  if (has("hi", "hello", "hey", "namaste")) {
    return {
      text: "Hello! I’m the Nivasa concierge. Ask me about our homes, prices, visits, or listing your own property.",
    };
  }
  if (has("list", "sell my", "sell our", "my property", "my home", "my flat", "my apartment")) {
    return { text: "Happy to help you list. I’m opening our owner form now.", action: "openList" };
  }
  if (has("map", "where are", "located", "location")) {
    return {
      text: localities.length
        ? `We have homes in ${listLocalities(localities)}. Opening the map for you.`
        : "Opening the map for you.",
      action: "openMap",
    };
  }
  if (has("price", "cost", "emi", "budget", "how much", "stamp")) {
    return {
      text: "Pricing is shared on request — we walk you through the full cost, with zero brokerage, once you enquire. Open any home to see the numbers.",
    };
  }
  if (has("visit", "schedule", "see the", "tour", "viewing", "appointment")) {
    return {
      text: "I can set up a site visit. Open any home and tap Schedule a Site Visit — the owner will meet you there directly.",
    };
  }
  if (has("brokerage", "broker", "fee", "commission")) {
    return {
      text: "Nivasa charges zero brokerage. You deal directly with the owner, with no middlemen on either side.",
    };
  }
  if (has("saved", "shortlist", "favourite", "favorite")) {
    return {
      text: "Your saved homes live under Saved in the menu — tap the heart on any listing to shortlist it.",
    };
  }
  if (has("video", "walkthrough")) {
    return {
      text: "Most homes have a video walkthrough on their detail page — look for the play button under the photos.",
    };
  }
  if (has("thank", "thanks", "bye")) {
    return { text: "Anytime. Happy house-hunting with Nivasa." };
  }
  return {
    text: "I can help with our homes, pricing, site visits, or listing your own property. What would you like to know?",
  };
}

/* --- Minimal Web Speech typings: still vendor-prefixed and outside lib.dom. --- */

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
