"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getSpeechRecognition, replyTo, type SpeechRecognitionLike } from "@/lib/voice";

import { useNivasa } from "./nivasa-store";
import { SERIF } from "./ui";

const IDLE_STATUS = "Tap the mic and ask away";
const UNSUPPORTED_STATUS = "Voice isn’t supported in this browser.";

function MicIcon({ size = 38 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0014 0M12 18v3" />
    </svg>
  );
}

export function VoiceConcierge() {
  const s = useNivasa();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  // Resolved once, lazily: the API is still vendor-prefixed and absent on some browsers.
  const [supported] = useState(() => getSpeechRecognition() !== null);
  const [status, setStatus] = useState(supported ? IDLE_STATUS : UNSUPPORTED_STATUS);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Handlers fire outside React's flow; read the current actions through a ref.
  const actions = useRef({ openList: s.openList, openMap: s.openMap });
  const localitiesRef = useRef<string[]>([]);
  useEffect(() => {
    actions.current = { openList: s.openList, openMap: s.openMap };
    localitiesRef.current = s.properties.map((p) => p.locality);
  }, [s.openList, s.openMap, s.properties]);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-IN";
      window.speechSynthesis.speak(utterance);
    } catch {
      /* speech synthesis is optional */
    }
  }, []);

  useEffect(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const heard = event.results[0][0].transcript;
      const answer = replyTo(heard, localitiesRef.current);
      setTranscript(heard);
      setReply(answer.text);
      setListening(false);
      setStatus("Tap the mic to ask again");
      speak(answer.text);
      if (answer.action) {
        setTimeout(() => {
          setOpen(false);
          actions.current[answer.action as "openList" | "openMap"]();
        }, 700);
      }
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
      setStatus(
        event.error === "not-allowed"
          ? "Microphone blocked — allow access to talk."
          : "Didn’t catch that — tap to try again.",
      );
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    };
  }, [speak]);

  const close = useCallback(() => {
    setOpen(false);
    setListening(false);
    try {
      recognitionRef.current?.abort();
    } catch {
      /* already stopped */
    }
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  const micTap = () => {
    if (!supported) {
      setStatus("Voice isn’t supported here — use Enquire instead.");
      return;
    }
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* nothing to stop */
      }
      return;
    }
    window.speechSynthesis?.cancel();
    try {
      recognitionRef.current?.start();
      setListening(true);
      setStatus("Listening…");
      setTranscript("");
      setReply("");
    } catch {
      /* start() throws if already running */
    }
  };

  return (
    <>
      <button
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="Voice concierge"
        aria-expanded={open}
        className="nv-btn-gold"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 58,
          height: 58,
          borderRadius: "50%",
          background: "#A16207",
          color: "#fff",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          zIndex: 120,
          boxShadow: "0 16px 34px -10px rgba(161,98,7,0.6)",
        }}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <MicIcon size={24} />
        )}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 94,
            right: 24,
            width: 344,
            maxWidth: "calc(100vw - 32px)",
            background: "#1C1917",
            color: "#fff",
            borderRadius: 16,
            zIndex: 119,
            boxShadow: "0 34px 70px -22px rgba(0,0,0,0.7)",
            overflow: "hidden",
            animation: "nvmodal .24s ease",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "20px 22px",
              borderBottom: "1px solid #2e2825",
            }}
          >
            <div>
              <p style={{ fontFamily: SERIF, fontSize: "1.1rem", margin: 0, color: "#fff", letterSpacing: "0.02em" }}>
                Nivasa Voice
              </p>
              <p style={{ fontSize: "0.74rem", color: "#948C84", margin: "3px 0 0" }}>
                Your home concierge
              </p>
            </div>
            <button
              onClick={close}
              aria-label="Close"
              className="nv-btn-close"
              style={{
                background: "none",
                border: "none",
                color: "#948C84",
                cursor: "pointer",
                fontSize: "1.4rem",
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          <div style={{ padding: "30px 22px 24px", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <button
              onClick={micTap}
              aria-label="Tap to speak"
              aria-pressed={listening}
              className="nv-btn-mic"
              style={{
                position: "relative",
                width: 96,
                height: 96,
                borderRadius: "50%",
                background: "#A16207",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "#fff",
              }}
            >
              {listening && (
                <>
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      border: "2px solid #C99A3F",
                      animation: "nvring 1.6s ease-out infinite",
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      border: "2px solid #C99A3F",
                      animation: "nvring 1.6s ease-out infinite .6s",
                    }}
                  />
                </>
              )}
              <MicIcon />
            </button>

            <p
              style={{
                fontSize: "0.82rem",
                color: "#C0BAB2",
                margin: "18px 0 0",
                textAlign: "center",
                letterSpacing: "0.02em",
              }}
            >
              {status}
            </p>

            {transcript && (
              <div style={{ alignSelf: "stretch", marginTop: 20, background: "#26211D", borderRadius: 10, padding: "14px 16px" }}>
                <p
                  style={{
                    fontSize: "0.66rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "#7d766f",
                    margin: "0 0 5px",
                  }}
                >
                  You asked
                </p>
                <p style={{ fontSize: "0.92rem", color: "#F5F0E8", margin: 0 }}>{transcript}</p>
              </div>
            )}

            {reply && (
              <div
                style={{
                  alignSelf: "stretch",
                  marginTop: 12,
                  background: "#1F1B18",
                  border: "1px solid #2e2825",
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <p
                  style={{
                    fontSize: "0.66rem",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "#C99A3F",
                    margin: "0 0 5px",
                  }}
                >
                  Nivasa
                </p>
                <p style={{ fontSize: "0.92rem", color: "#E7DFD3", margin: 0, lineHeight: 1.6 }}>{reply}</p>
              </div>
            )}
          </div>

          <p
            style={{
              fontSize: "0.68rem",
              color: "#7d766f",
              margin: 0,
              padding: "0 22px 20px",
              textAlign: "center",
              textWrap: "pretty",
            }}
          >
            Demo concierge · speech stays on your device. In production this connects to a live
            assistant.
          </p>
        </div>
      )}
    </>
  );
}
