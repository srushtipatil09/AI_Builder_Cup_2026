import { useEffect, useRef, useState } from "react";
import { LiveAudio, toBase64 } from "../lib/liveAudio";
import { currentIdToken } from "../lib/firebase";
import { completeSession, contactFamily, invitationEvent, nextInvitation, sendHeartbeat, simulateInactivity, textTurn } from "../lib/api";
import { enableParentPush, pushMessage } from "../lib/push";
import { readSession } from "../session";
import { InstallSheet } from "./InstallSheet";

type Props = { demo: boolean; name?: string; householdId?: string };

type Message = { id: string; role: "parent" | "assistant"; text: string };

export function CompanionChat({ demo, name, householdId }: Props) {
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "thinking" | "speaking" | "paused">("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [alertNote, setAlertNote] = useState<string>("");
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
  const [pushNote, setPushNote] = useState("");
  // Contact family asks once before it sends, so a stray tap does not alarm anyone.
  const [confirmFamily, setConfirmFamily] = useState(false);

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
      utterance.lang = "hi-IN";
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
        recognition.lang = "hi-IN";
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
    const greeting = late
      ? `Namaste${name ? ` ${name}` : ""}, raat ho gayi hai. Sab theek hai na?`
      : demo
        ? "Namaste Kamla ji, chai ho gayi? Aaj kaisa lag raha hai?"
        : `Namaste${name ? ` ${name}` : ""}, aaj aapka din kaisa raha?`;
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
          setAlertNote("Your family has been told. If you need help right now, call local emergency services.");
        } else if (data.type === "impact_label") {
          setAlertNote(
            data.category === "possible_impact"
              ? "A loud sound was heard. Saathi is asking if you are all right."
              : "An ordinary sound was heard (a door, a spoon, the TV). No alert was raised.",
          );
        } else if (data.type === "error") {
          setChatError(
            /not have access|authent|auth/i.test(String(data.message))
              ? "Saathi could not confirm who you are. Log in again, then tap Talk."
              : "Saathi ran into a problem. Tap Talk to try again.",
          );
        } else if (data.type === "ended") {
          stopSession();
        } else if (data.type === "thinking") {
          setStatus("thinking");
        } else if (data.type === "transcript") {
          setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text: data.text }]);
          speakText(data.text);
          if (data.distress) {
            setAlertNote("Saathi is checking on you. If nobody answers, your family is told.");
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
    const text = "Main parivaar ko alert bhej rahi hoon ki aap baat karna chahte hain.";
    setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text }]);
    speakText(text);
    contactFamily(hhRef.current)
      .then(() => setAlertNote("Your family has been told you want to talk."))
      .catch(() => setAlertNote("Could not reach your family just now. Please call them."));
  }

  function sendDemoClip(clip: "thud" | "door", note: string) {
    setAlertNote(note);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "demo_clip", clip }));
    } else {
      setAlertNote("Tap Talk first so Saathi is connected, then play the clip.");
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
    setAlertNote("Simulated. This build does not read a Nest sensor.");
    simulateInactivity()
      .then(() => void startFromInvite())
      .catch(() => setAlertNote("Could not reach Saathi to simulate inactivity. Try again."));
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
    } catch {
      // The invitation is tried again on the next poll.
    }
  }
  const pollRef = useRef(startFromInvite);
  pollRef.current = startFromInvite;

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !hhRef.current) return;
      void sendHeartbeat(hhRef.current).catch(() => {});
      void pollRef.current();
    }, 5000);
    return () => window.clearInterval(id);
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

  const headline: Record<typeof status, { hi: string; en: string }> = {
    idle: { hi: "बात करने के लिए दबाएँ", en: "Tap the green button to talk to Saathi" },
    connecting: { hi: "जुड़ रहा है…", en: "Connecting to Saathi" },
    listening: { hi: "सुन रहा हूँ", en: "Listening. Speak in Hindi or English." },
    thinking: { hi: "सोच रहा हूँ…", en: "Saathi is thinking" },
    speaking: { hi: "साथी बोल रहा है", en: "Saathi is speaking" },
    paused: { hi: "रुका हुआ है", en: "Paused. Saathi is not listening." },
  };
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
          {demo ? <span lang="hi">नमस्ते कमला जी</span> : `Namaste${name ? `, ${name} ji` : ""}`}
        </p>
        <h1 id="chat-title" aria-live="polite">
          <span lang="hi">{headline[status].hi}</span>
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
        {alertNote ? (
          <p className="chat-note" role="status">
            {alertNote}
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

      {!demo && hhRef.current ? (
        <p className="push-opt">
          <button
            className="text-link"
            type="button"
            onClick={() => void enableParentPush(hhRef.current).then((r) => setPushNote(pushMessage(r)))}
          >
            Get a reminder when it is time to talk
          </button>
          {pushNote ? <span> {pushNote}</span> : null}
        </p>
      ) : null}

      <InstallSheet />

      <div className="controls" role="group" aria-label="Conversation">
        {confirmFamily ? (
          <div className="family-confirm" role="alertdialog" aria-labelledby="family-confirm-title">
            <p id="family-confirm-title">
              <span lang="hi">परिवार को बताएँ कि आप बात करना चाहते हैं?</span>
              <span>Tell your family you want to talk?</span>
            </p>
            <div className="family-confirm-actions">
              <button className="primary" type="button" onClick={contactFamilyNow} autoFocus>
                <span lang="hi" className="control-hi">हाँ, बताएँ</span>
                <span className="control-en">Yes, tell them</span>
              </button>
              <button className="ghost" type="button" onClick={() => setConfirmFamily(false)}>
                <span lang="hi" className="control-hi">नहीं</span>
                <span className="control-en">No</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <button className={`primary control-talk ${live && !busy ? "active" : ""}`} type="button" onClick={talk} disabled={talkDisabled}>
              <span lang="hi" className="control-hi">
                {status === "paused" ? "फिर शुरू करें" : status === "idle" ? "बात करें" : busy ? "एक पल…" : "सुन रहा हूँ…"}
              </span>
              <span className="control-en">
                {status === "paused" ? "Resume" : status === "idle" ? "Talk" : busy ? "One moment" : "Listening"}
              </span>
            </button>
            <button className="ghost" type="button" onClick={stopSession} disabled={!live}>
              <span lang="hi" className="control-hi">
                बंद करें
              </span>
              <span className="control-en">Stop</span>
            </button>
            <button className="ghost" type="button" onClick={togglePause} disabled={!live || busy}>
              <span lang="hi" className="control-hi">
                {status === "paused" ? "चालू करें" : "रुकें"}
              </span>
              <span className="control-en">{status === "paused" ? "Resume" : "Pause"}</span>
            </button>
            <button className="ghost control-family" type="button" onClick={() => setConfirmFamily(true)}>
              <span lang="hi" className="control-hi">
                परिवार
              </span>
              <span className="control-en">Contact family</span>
            </button>
          </>
        )}
      </div>
    </section>
  );
}
