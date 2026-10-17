import { useEffect, useRef, useState } from "react";
import { LiveAudio, toBase64 } from "../lib/liveAudio";
import { currentIdToken } from "../lib/firebase";
import { nextDelay } from "../lib/activity";
import { completeSession, contactFamily, invitationEvent, nextInvitation, pausedForMs, sendHeartbeat, simulateInactivity, textTurn } from "../lib/api";
import { enableParentPush, pushMessage } from "../lib/push";
import { readSession } from "../session";
import { languageFor } from "../lib/languages";
import { useAppDispatch } from "../store";
import { nearbyForget, nearbyFound } from "../store/reads";
import { InstallSheet } from "./InstallSheet";
import { NearbyPanel, type NearbyCard } from "./NearbyPanel";
import { telHref } from "./NearbyList";
import { locationChoice, locationMessage, shareLocationOnce } from "../lib/location";
import { useToast } from "../toast";

type Props = { demo: boolean; name?: string; householdId?: string };

type Message = { id: string; role: "parent" | "assistant"; text: string };

export function CompanionChat({ demo, name, householdId }: Props) {
  const dispatch = useAppDispatch();
  const toast = useToast();
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "thinking" | "speaking" | "paused">("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatError, setChatError] = useState<string>("");
  const socketRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<LiveAudio | null>(null);
  const openRoleRef = useRef<string | null>(null);
  const liveReadyRef = useRef(false);
  const wantTalkRef = useRef(false);
  const audioOkRef = useRef(true);
  const startedAtRef = useRef(0);
  const hhRef = useRef("");
  hhRef.current = demo ? "demo-kamla-sharma" : householdId || "";
  const sessionIdRef = useRef<string>(`sess-${Math.random().toString(36).slice(2, 10)}`);
  // The check-in Saathi started: shown as a banner, and answered by speaking, Later, or a blocked microphone.
  const [invite, setInvite] = useState<{ id: string; reason: string } | null>(null);
  const inviteRef = useRef<{ id: string; reason: string } | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  // Contact family asks once before it sends, so a stray tap does not alarm anyone.
  const [confirmFamily, setConfirmFamily] = useState(false);
  // Nearby help: the sheet, a card the voice assistant found, and a Call button it offered. The parent taps; nothing dials itself.
  const [nearbyOpen, setNearbyOpen] = useState(false);
  const [nearbyCard, setNearbyCard] = useState<NearbyCard>(null);
  const [callOffer, setCallOffer] = useState<{ name: string; phone: string } | null>(null);
  const [locationAsked, setLocationAsked] = useState(() => locationChoice(householdId ?? ""));
  // The household's language: from the account first, then from the server once the line is open.
  const [language, setLanguage] = useState(() => languageFor(demo ? "Hindi" : readSession()?.language));
  const langRef = useRef(language);
  langRef.current = language;

  useEffect(() => {
    // Open the line while the page loads, so the greeting starts right after Talk is tapped.
    connectLive(true);
    return () => {
      stopSession();
    };
  }, []);

  async function beginTalking() {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    wantTalkRef.current = false;
    if (audioOkRef.current) {
      const audio = new LiveAudio();
      audio.onFrame = (pcm) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
      };
      audio.onPlaybackEnd = () => setStatus((st) => (st === "speaking" ? "listening" : st));
      // A loud sound while Saathi is silent: a short clip goes to the server for a label. Only a possible impact asks a question.
      audio.onLoudSound = (clip) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "impact_audio", audio: toBase64(clip) }));
      };
      try {
        await audio.start();
        audioRef.current = audio;
        ws.send(JSON.stringify({ type: "start" }));
        startedAtRef.current = Date.now();
        setStatus("thinking");
        return;
      } catch (err) {
        console.warn("Microphone unavailable, using browser speech", err);
        audio.stop();
        audioOkRef.current = false;
        // A blocked microphone is a device problem, not the parent ignoring Saathi.
        if (inviteRef.current && hhRef.current) {
          void invitationEvent(hhRef.current, inviteRef.current.id, "device_unavailable", "microphone_blocked").catch(() => {});
          inviteRef.current = null;
          setInvite(null);
        }
      }
    }
    ws.send(JSON.stringify({ type: "text_mode" }));
    fallbackGreeting();
  }

  function speakText(text: string) {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langRef.current.code;
      utterance.rate = 0.95;
      utterance.onstart = () => setStatus("speaking");
      utterance.onend = () => {
        if (statusRef.current === "paused") return;
        setStatus("listening");
        startListening();
      };
      window.speechSynthesis.speak(utterance);
    }
  }

  function startListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition && !recognitionRef.current) {
      try {
        const recognition = new SpeechRecognition();
        recognition.lang = langRef.current.code;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            handleUserUtterance(transcript);
          }
        };
        recognition.onerror = () => {
          recognitionRef.current = null;
        };
        recognition.onend = () => {
          recognitionRef.current = null;
        };
        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.warn("Speech recognition error:", err);
      }
    }
  }

  function fallbackGreeting() {
    setStatus("listening");
    // After 9 pm and before 5 am the hello is calm: no chai, no questions about the day.
    const hour = new Date().getHours();
    const late = hour >= 21 || hour < 5;
    const words = langRef.current.words;
    const n = name ? ` ${name}` : "";
    const greeting = late
      ? words.late(n)
      : demo && langRef.current.name === "Hindi"
        ? "Namaste Kamla ji, chai ho gayi? Aaj kaisa lag raha hai?"
        : words.greet(n);
    setMessages([{ id: "init", role: "assistant", text: greeting }]);
    speakText(greeting);
  }

  // Live captions arrive in pieces; keep growing one line per speaker turn.
  function addCaption(role: "parent" | "assistant", text: string) {
    if (role === "parent" && inviteRef.current && hhRef.current) {
      void invitationEvent(hhRef.current, inviteRef.current.id, "responded").catch(() => {});
      inviteRef.current = null;
      setInvite(null);
    }
    const merge = openRoleRef.current === role;
    openRoleRef.current = role;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (merge && last && last.role === role) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { id: Math.random().toString(), role, text: text.trimStart() }];
    });
  }

  function connectLive(early = false) {
    if (socketRef.current) return;
    liveReadyRef.current = false;
    setStatus(early ? "idle" : "connecting");
    const apiUrl = import.meta.env.VITE_API_URL;
    let wsUrl: string;
    if (apiUrl) {
      const wsProto = String(apiUrl).startsWith("https") ? "wss:" : "ws:";
      const cleanHost = String(apiUrl).replace(/^https?:\/\//, "").replace(/\/+$/, "");
      wsUrl = `${wsProto}//${cleanHost}/api/v1/sessions/${sessionIdRef.current}/live`;
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.host;
      wsUrl = `${protocol}//${host}/api/v1/sessions/${sessionIdRef.current}/live`;
    }

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      let token = "demo";
      try {
        token = (await currentIdToken()) ?? "demo";
      } catch {
        // stay on the demo token
      }
      ws.send(JSON.stringify({
        type: "authenticate",
        token: demo ? "demo" : token,
        householdId: hhRef.current,
        role: "parent",
        familyCode: readSession()?.familyCode ?? "",
      }));
    };

    ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
        if (statusRef.current === "paused") return;
        setStatus("speaking");
        audioRef.current?.play(event.data);
        return;
      }
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ready") {
          audioOkRef.current = !!data.audio;
          if (data.language) setLanguage(languageFor(String(data.language)));
        } else if (data.type === "live_ready") {
          liveReadyRef.current = true;
          if (wantTalkRef.current) void beginTalking();
        } else if (data.type === "audio_unavailable") {
          audioRef.current?.stop();
          audioRef.current = null;
          audioOkRef.current = false;
          liveReadyRef.current = true;
          if (wantTalkRef.current) void beginTalking();
        } else if (data.type === "caption") {
          addCaption(data.role === "parent" ? "parent" : "assistant", data.text);
        } else if (data.type === "interrupted") {
          audioRef.current?.interrupt();
          setStatus("listening");
        } else if (data.type === "turn_complete") {
          openRoleRef.current = null;
        } else if (data.type === "alert") {
          toast("Your family has been told. If you need help right now, call local emergency services.", "info");
        } else if (data.type === "impact_label") {
          toast(
            data.category === "possible_impact"
              ? "A loud sound was heard. Saathi is asking if you are all right."
              : "An ordinary sound was heard (a door, a spoon, the TV). No alert was raised.",
            "info",
          );
        } else if (data.type === "error") {
          setChatError(
            /not have access|authent|auth/i.test(String(data.message))
              ? "Saathi could not confirm who you are. Log in again, then tap Talk."
              : "Saathi ran into a problem. Tap Talk to try again.",
          );
        } else if (data.type === "nearby") {
          setNearbyCard({ kind: data.kind, items: data.items ?? [], positionShared: !!data.positionShared });
          // The same list fills the sheet, so opening it does not look the places up again.
          dispatch(nearbyFound({ householdId: hhRef.current, kind: String(data.kind), items: data.items ?? [], positionShared: !!data.positionShared }));
          setNearbyOpen(true);
        } else if (data.type === "call_offer") {
          setCallOffer({ name: String(data.name ?? ""), phone: String(data.phone ?? "") });
        } else if (data.type === "ended") {
          stopSession();
        } else if (data.type === "thinking") {
          setStatus("thinking");
        } else if (data.type === "transcript") {
          setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text: data.text }]);
          speakText(data.text);
          if (data.distress) {
            toast("Saathi is checking on you. If nobody answers, your family is told.", "info");
          }
        }
      } catch (err) {
        console.error("WS error parsing message", err);
      }
    };

    ws.onerror = () => {
      setStatus("idle");
      if (!early || wantTalkRef.current) setChatError("Could not reach Saathi. Check the connection and tap Talk to try again.");
    };

    ws.onclose = (event) => {
      if (event.code === 1008) setChatError("Saathi could not confirm who you are. Log in again, then tap Talk.");
      else if (startedAtRef.current && event.code !== 1000) setChatError("The connection dropped. Tap Talk to reconnect.");
      setStatus("idle");
      socketRef.current = null;
      liveReadyRef.current = false;
    };
  }

  function handleUserUtterance(text: string) {
    setStatus("thinking");
    setMessages((prev) => [...prev, { id: Math.random().toString(), role: "parent", text }]);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "user_transcript", text }));
    } else {
      // Fallback via HTTP turn
      textTurn(sessionIdRef.current, hhRef.current, text)
        .then((reply) => {
          if (reply) {
            setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text: reply }]);
            speakText(reply);
          }
        })
        .catch(() => {});
    }
  }

  function stopSession() {
    if (startedAtRef.current && audioRef.current) {
      const gap = audioRef.current.medianGap();
      completeSession(sessionIdRef.current, hhRef.current, {
        duration_seconds: (Date.now() - startedAtRef.current) / 1000,
        response_gap_ms: gap,
        quality_flags: gap === undefined ? ["no_turns_measured"] : [],
      }).catch(() => {});
      startedAtRef.current = 0;
      sessionIdRef.current = `sess-${Math.random().toString(36).slice(2, 10)}`;
    }
    audioRef.current?.stop();
    audioRef.current = null;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (socketRef.current) {
      try {
        socketRef.current.send(JSON.stringify({ type: "end" }));
        socketRef.current.close();
      } catch {}
      socketRef.current = null;
    }
    setStatus("idle");
  }

  function contactFamilyNow() {
    setConfirmFamily(false);
    const text = langRef.current.words.telling;
    setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text }]);
    speakText(text);
    contactFamily(hhRef.current)
      .then(() => toast("Your family has been told you want to talk.", "ok"))
      .catch(() => toast("Could not reach your family just now. Please call them.", "bad"));
  }

  function sendDemoClip(clip: "thud" | "door", note: string) {
    toast(note, "info");
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "demo_clip", clip }));
    } else {
      toast("Tap Talk first so Saathi is connected, then play the clip.", "bad");
    }
  }

  function playDistressClip() {
    sendDemoClip("thud", "Labeled recording: a loud thud. Saathi will ask if you are all right.");
  }

  function playDoorClip() {
    sendDemoClip("door", "Labeled recording: an ordinary door. No alert should be raised.");
  }

  // Labeled simulation: the same invitation the scheduler sends, picked up by this open chat.
  function simulateMorningInactivity() {
    toast("Simulated. This build does not read a Nest sensor.", "info");
    simulateInactivity()
      .then(() => void startFromInvite())
      .catch(() => toast("Could not reach Saathi to simulate inactivity. Try again.", "bad"));
  }

  // The open chat tells the server it is ready, and picks up a check-in Saathi has started.
  async function startFromInvite() {
    if (statusRef.current !== "idle" || inviteRef.current || !hhRef.current) return;
    try {
      const { invitation } = await nextInvitation(hhRef.current);
      if (!invitation) return;
      inviteRef.current = invitation;
      setInvite(invitation);
      void invitationEvent(hhRef.current, invitation.id, "played").catch(() => {});
      wantTalkRef.current = true;
      if (!socketRef.current) connectLive();
      else if (liveReadyRef.current) void beginTalking();
      pollFailures.current = 0;
    } catch {
      // The invitation is tried again on the next poll, later each time the API keeps failing.
      pollFailures.current += 1;
    }
  }
  const pollFailures = useRef(0);
  const pollRef = useRef(startFromInvite);
  pollRef.current = startFromInvite;

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    let lastBeat = 0;
    const tick = () => {
      if (stopped) return;
      if (document.visibilityState === "visible" && hhRef.current && pausedForMs() === 0) {
        // Ready-signal every 30 seconds; the invitation check every 10 so a check-in starts within about 10 seconds.
        if (Date.now() - lastBeat > 30_000) {
          lastBeat = Date.now();
          void sendHeartbeat(hhRef.current).catch(() => {});
        }
        void pollRef.current();
      }
      timer = window.setTimeout(tick, nextDelay(10_000, pollFailures.current, pausedForMs(), false));
    };
    timer = window.setTimeout(tick, 10_000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  function snoozeInvite() {
    if (inviteRef.current && hhRef.current) {
      void invitationEvent(hhRef.current, inviteRef.current.id, "snoozed").catch(() => {});
    }
    inviteRef.current = null;
    setInvite(null);
    wantTalkRef.current = false;
  }

  function talk() {
    setChatError("");
    if (status === "idle") {
      wantTalkRef.current = true;
      if (!socketRef.current) {
        connectLive();
      } else if (liveReadyRef.current) {
        void beginTalking();
      } else {
        setStatus("connecting");
      }
    } else if (status === "paused") {
      togglePause();
    }
  }

  // Pause really pauses: no microphone audio is sent and Saathi stops speaking until Resume.
  function togglePause() {
    if (status === "paused") {
      audioRef.current?.resume();
      setStatus("listening");
      if (!audioRef.current) startListening();
      return;
    }
    if (status === "idle") return;
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setStatus("paused");
  }

  // Each label shows the parent's language on top and English below; for English only the English line.
  const w = language.words;
  const lang = language.code.slice(0, 2);
  const twoLines = language.name !== "English";
  const headline: Record<typeof status, { hi: string; en: string }> = {
    idle: { hi: w.idle, en: "Tap the green button to talk to Saathi" },
    connecting: { hi: w.connecting, en: "Connecting to Saathi" },
    listening: { hi: w.listening, en: twoLines ? `Listening. Speak in ${language.name} or English.` : "Listening. Speak in English or Hindi." },
    thinking: { hi: w.thinking, en: "Saathi is thinking" },
    speaking: { hi: w.speaking, en: "Saathi is speaking" },
    paused: { hi: w.paused, en: "Paused. Saathi is not listening." },
  };
  const said = (native: string) =>
    twoLines ? (
      <span lang={lang} className="control-hi">
        {native}
      </span>
    ) : null;
  const busy = status === "connecting" || status === "thinking";
  const live = status !== "idle";
  const talkDisabled = busy || status === "listening" || status === "speaking";
  const orbState =
    status === "listening"
      ? "orb-listening"
      : status === "speaking"
        ? "orb-speaking"
        : busy
          ? "orb-thinking"
          : status === "paused"
            ? "orb-paused"
            : "";

  return (
    <section className="chat-screen" aria-labelledby="chat-title">
      <div className="companion">
        <button
          className={`orb ${orbState}`}
          type="button"
          onClick={talk}
          disabled={talkDisabled}
          aria-label={status === "paused" ? "Resume" : "Talk to Saathi"}
        >
          <span lang="hi" aria-hidden="true">
            सा
          </span>
        </button>
        <p className="companion-line">
          {demo && language.name === "Hindi" ? (
            <span lang="hi">नमस्ते कमला जी</span>
          ) : language.name === "Hindi" || !twoLines ? (
            `Namaste${name ? `, ${name} ji` : ""}`
          ) : (
            <span lang={lang}>{`${w.hello}${name ? `, ${name}` : ""}`}</span>
          )}
        </p>
        <h1 id="chat-title" aria-live="polite">
          {twoLines ? <span lang={lang}>{headline[status].hi}</span> : null}
          <span className="companion-state">{headline[status].en}</span>
        </h1>
        {invite ? (
          <p className="invite-chip">
            <span>Saathi wants to talk.</span>
            <button className="text-link" type="button" onClick={snoozeInvite}>
              Later
            </button>
          </p>
        ) : null}
        {chatError ? (
          <p className="chat-error" role="alert">
            {chatError}
          </p>
        ) : null}
      </div>

      <article className="captions" aria-label="Captions">
        {messages.length === 0 ? (
          <p className="captions-empty">What you and Saathi say appears here as text.</p>
        ) : (
          <ol className="caption-list">
            {messages.map((m) => (
              <li key={m.id} className={m.role === "assistant" ? "caption caption-saathi" : "caption caption-you"}>
                <span className="caption-who">{m.role === "assistant" ? "Saathi" : "You"}</span>
                {m.text}
              </li>
            ))}
          </ol>
        )}
      </article>

      {demo ? (
        <details className="demo-panel">
          <summary>
            <span className="demo-tag">Demo</span>
            <span>Demo controls</span>
          </summary>
          <ul>
            <li>
              <button className="ghost" type="button" onClick={simulateMorningInactivity}>
                Simulate morning inactivity
              </button>
              <span>Simulated. This build does not read a Nest sensor. Saathi starts a check-in the way the scheduler does.</span>
            </li>
            <li>
              <button className="ghost" type="button" onClick={playDistressClip}>
                Play labeled distress clip
              </button>
              <span>Labeled recording. The spoken check and the alert use the live rule.</span>
            </li>
            <li>
              <button className="ghost" type="button" onClick={playDoorClip}>
                Play ordinary door clip
              </button>
              <span>Labeled recording. An ordinary door does not raise an alert.</span>
            </li>
            <li>
              <button className="ghost" type="button" onClick={() => handleUserUtterance("Rahul roz phone karta hai, par aaj baat nahi hui.")}>
                Run seeded session
              </button>
              <span>Recorded transcript, sent as typed text. Excluded from speech measurements.</span>
            </li>
          </ul>
        </details>
      ) : null}

      {callOffer ? (
        <div className="call-offer" role="alert">
          <p>
            {twoLines ? <span lang={lang}>{w.call}:</span> : null} <strong>{callOffer.name}</strong>
          </p>
          <a className="primary call-offer-button" href={telHref(callOffer.phone)}>
            {twoLines ? <span lang={lang}>{w.call}</span> : null} <span className="control-en">Call {callOffer.name}</span>
          </a>
          <button className="text-link" type="button" onClick={() => setCallOffer(null)}>
            {twoLines ? <span lang={lang}>{w.no}</span> : null} <span className="control-en">Not now</span>
          </button>
        </div>
      ) : null}

      <button className="ghost nearby-open" type="button" onClick={() => { setNearbyCard(null); setNearbyOpen(true); }}>
        {said(w.nearby)}
        <span className="control-en">Nearby help: hospital, park, people, food</span>
      </button>
      {!demo && hhRef.current && !locationAsked ? (
        <p className="push-opt">
          <button
            className="text-link"
            type="button"
            onClick={() =>
              void shareLocationOnce(hhRef.current).then((r) => {
                if (r === "saved") dispatch(nearbyForget(hhRef.current));
                toast(locationMessage(r), r === "saved" ? "ok" : r === "error" ? "bad" : "info");
                setLocationAsked(locationChoice(hhRef.current));
              })
            }
          >
            Allow location once, so Saathi can find help near you
          </button>
        </p>
      ) : null}
      {nearbyOpen ? <NearbyPanel householdId={hhRef.current} demo={demo} card={nearbyCard} language={language} onClose={() => setNearbyOpen(false)} /> : null}

      {hhRef.current ? (
        <p className="push-opt">
          <button
            className="text-link"
            type="button"
            onClick={() => void enableParentPush(hhRef.current).then((r) => toast(pushMessage(r), r === "on" ? "ok" : r === "error" ? "bad" : "info"))}
          >
            Get a reminder when it is time to talk
          </button>
        </p>
      ) : null}

      <InstallSheet />

      <div className="controls" role="group" aria-label="Conversation">
        {confirmFamily ? (
          <div className="family-confirm" role="alertdialog" aria-labelledby="family-confirm-title">
            <p id="family-confirm-title">
              {twoLines ? <span lang={lang}>{w.askFamily}</span> : null}
              <span>Tell your family you want to talk?</span>
            </p>
            <div className="family-confirm-actions">
              <button className="primary" type="button" onClick={contactFamilyNow} autoFocus>
                {said(w.yesTell)}
                <span className="control-en">Yes, tell them</span>
              </button>
              <button className="ghost" type="button" onClick={() => setConfirmFamily(false)}>
                {said(w.no)}
                <span className="control-en">No</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className={`primary control-talk ${live && !busy ? "active" : ""}`} type="button" onClick={talk} disabled={talkDisabled}>
              {said(status === "paused" ? w.resume : status === "idle" ? w.talk : busy ? w.moment : `${w.listening}…`)}
              <span className="control-en">
                {status === "paused" ? "Resume" : status === "idle" ? "Talk" : busy ? "One moment" : "Listening"}
              </span>
            </button>
            <button className="ghost" type="button" onClick={stopSession} disabled={!live}>
              {said(w.stop)}
              <span className="control-en">Stop</span>
            </button>
            <button className="ghost" type="button" onClick={togglePause} disabled={!live || busy}>
              {said(status === "paused" ? w.resume : w.pause)}
              <span className="control-en">{status === "paused" ? "Resume" : "Pause"}</span>
            </button>
            <button className="ghost control-family" type="button" onClick={() => setConfirmFamily(true)}>
              {said(w.family)}
              <span className="control-en">Contact family</span>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
