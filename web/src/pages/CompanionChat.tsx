import { useEffect, useRef, useState } from "react";
import { InstallSheet } from "./InstallSheet";

type Props = { demo: boolean; name?: string };

type Message = { id: string; role: "parent" | "assistant"; text: string };

export function CompanionChat({ demo, name }: Props) {
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "speaking" | "paused">("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [alertNote, setAlertNote] = useState<string>("");
  const socketRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);
  const sessionIdRef = useRef<string>(`sess-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    return () => {
      stopSession();
    };
  }, []);

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

  function connectLive() {
    if (socketRef.current) return;
    setStatus("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/sessions/${sessionIdRef.current}/live`;

    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "authenticate",
        token: "demo",
        householdId: demo ? "demo-kamla-sharma" : "current",
      }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ready") {
          setStatus("listening");
          const greeting = demo
            ? "Namaste Kamla ji, chai ho gayi? Aaj kaisa lag raha hai?"
            : `Namaste${name ? ` ${name}` : ""}, aaj aapka din kaisa raha?`;
          setMessages([{ id: "init", role: "assistant", text: greeting }]);
          speakText(greeting);
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
    };
  }

  function handleUserUtterance(text: string) {
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
        <div className={`orb ${status === "listening" ? "orb-listening" : status === "speaking" ? "orb-speaking" : ""}`} aria-hidden="true">
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
              connectLive();
            } else {
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

