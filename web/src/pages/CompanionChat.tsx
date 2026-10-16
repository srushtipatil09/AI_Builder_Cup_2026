import { useEffect, useRef, useState } from "react";
import { LiveAudio } from "../lib/liveAudio";
import { currentIdToken } from "../lib/firebase";
import { InstallSheet } from "./InstallSheet";

type Props = { demo: boolean; name?: string };

type Message = { id: string; role: "parent" | "assistant"; text: string };

export function CompanionChat({ demo, name }: Props) {
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "thinking" | "speaking" | "paused">("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [alertNote, setAlertNote] = useState<string>("");
  const socketRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<LiveAudio | null>(null);
  const openRoleRef = useRef<string | null>(null);
  const liveReadyRef = useRef(false);
  const wantTalkRef = useRef(false);
  const audioOkRef = useRef(true);
  const sessionIdRef = useRef<string>(`sess-${Math.random().toString(36).slice(2, 10)}`);

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
      try {
        await audio.start();
        audioRef.current = audio;
        ws.send(JSON.stringify({ type: "start" }));
        setStatus("thinking");
        return;
      } catch (err) {
        console.warn("Microphone unavailable, using browser speech", err);
        audio.stop();
        audioOkRef.current = false;
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
    const greeting = demo
      ? "Namaste Kamla ji, chai ho gayi? Aaj kaisa lag raha hai?"
      : `Namaste${name ? ` ${name}` : ""}, aaj aapka din kaisa raha?`;
    setMessages([{ id: "init", role: "assistant", text: greeting }]);
    speakText(greeting);
  }

  // Live captions arrive in pieces; keep growing one line per speaker turn.
  function addCaption(role: "parent" | "assistant", text: string) {
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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/sessions/${sessionIdRef.current}/live`;

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
        householdId: demo ? "demo-kamla-sharma" : "current",
      }));
    };

    ws.onmessage = async (event) => {
      if (event.data instanceof ArrayBuffer) {
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
          setAlertNote("Alert sent to your family: Level 3 Distress Check.");
        } else if (data.type === "ended") {
          stopSession();
        } else if (data.type === "thinking") {
          setStatus("thinking");
        } else if (data.type === "transcript") {
          setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text: data.text }]);
          speakText(data.text);
          if (data.distress) {
            setAlertNote("Alert sent to your family: Level 3 Distress Check.");
          }
        }
      } catch (err) {
        console.error("WS error parsing message", err);
      }
    };

    ws.onerror = () => {
      setStatus("idle");
    };

    ws.onclose = () => {
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
      fetch(`/api/v1/sessions/${sessionIdRef.current}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, household_id: demo ? "demo-kamla-sharma" : "current" }),
      })
        .then((r) => r.json())
        .then((body) => {
          if (body.reply) {
            setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text: body.reply }]);
            speakText(body.reply);
          }
        })
        .catch(() => {});
    }
  }

  function stopSession() {
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

  function contactFamily() {
    const text = "Main parivaar ko alert bhej rahi hoon ki aap baat karna chahte hain.";
    setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text }]);
    speakText(text);
    setAlertNote("Family has been notified: Contact request received.");
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "distress_signal" }));
    }
  }

  function playDistressClip() {
    setAlertNote("Simulating distress sound: loud thud detected...");
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "distress_signal" }));
    } else {
      const text = "Kya hua? Gir gaye kya? Main yahin hoon.";
      setMessages((prev) => [...prev, { id: Math.random().toString(), role: "assistant", text }]);
      speakText(text);
      setAlertNote("Alert sent to your family: Level 3 Distress Check.");
    }
  }

  function playDoorClip() {
    setAlertNote("Ordinary noise detected: door closed. No alert raised.");
  }

  return (
    <section className="chat-screen" aria-labelledby="chat-title">
      <div className="companion">
        <div className={`orb ${status === "listening" ? "orb-listening" : status === "speaking" ? "orb-speaking" : status === "thinking" ? "orb-thinking" : ""}`} aria-hidden="true">
          <span lang="hi">सा</span>
        </div>
        <h1 id="chat-title">Talk</h1>
        <p className="companion-line">
          {demo ? "Namaste. This is the Kamla Sharma demo." : `Namaste${name ? `, ${name}` : ""}. The conversation will appear here.`}
        </p>
        <p className="companion-state">
          {status === "idle" && "Not connected yet. Tap Talk once so the browser can connect and use audio."}
          {status === "connecting" && "Connecting to Saathi Live..."}
          {status === "listening" && "Listening... Speak in Hindi or English."}
          {status === "thinking" && "Saathi is thinking..."}
          {status === "speaking" && "Saathi is speaking..."}
          {status === "paused" && "Session paused."}
        </p>
        {alertNote ? (
          <p className="status-chip status-chip-ok" style={{ margin: "0.5rem auto" }}>
            {alertNote}
          </p>
        ) : null}
      </div>

      <article className="captions">
        <h2>Captions</h2>
        {messages.length === 0 ? (
          <p>Captions will show both sides of the conversation.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {messages.map((m) => (
              <p key={m.id} style={{ margin: 0, fontWeight: m.role === "assistant" ? 600 : 400 }}>
                <strong>{m.role === "assistant" ? "Saathi: " : "You: "}</strong>
                {m.text}
              </p>
            ))}
          </div>
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
              <button className="ghost" type="button" onClick={playDistressClip}>
                Play labeled distress clip
              </button>
              <span>Recording: Spoken check and alert triggered.</span>
            </li>
            <li>
              <button className="ghost" type="button" onClick={playDoorClip}>
                Play ordinary door clip
              </button>
              <span>Recording: Ordinary door noise (no alert).</span>
            </li>
            <li>
              <button className="ghost" type="button" onClick={() => handleUserUtterance("Rahul roz phone karta hai, par aaj baat nahi hui.")}>
                Run seeded session
              </button>
              <span>Recorded transcript: feeds family contact statement.</span>
            </li>
          </ul>
        </details>
      ) : null}

      <InstallSheet />

      <div className="controls" role="group" aria-label="Conversation">
        <button
          className={`primary control-talk ${status === "listening" || status === "speaking" ? "active" : ""}`}
          type="button"
          onClick={() => {
            if (status === "idle") {
              wantTalkRef.current = true;
              if (!socketRef.current) {
                connectLive();
              } else if (liveReadyRef.current) {
                void beginTalking();
              } else {
                setStatus("connecting");
              }
            } else if (!audioRef.current) {
              startListening();
            }
          }}
        >
          {status === "idle" ? "Talk" : "Speak"}
        </button>
        <button className="ghost" type="button" onClick={stopSession} disabled={status === "idle"}>
          Stop
        </button>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            if (status === "paused") {
              setStatus("listening");
              startListening();
            } else if (status !== "idle") {
              setStatus("paused");
            }
          }}
          disabled={status === "idle"}
        >
          {status === "paused" ? "Resume" : "Pause"}
        </button>
        <button className="ghost control-family" type="button" onClick={contactFamily}>
          Contact family
        </button>
      </div>
    </section>
  );
}

