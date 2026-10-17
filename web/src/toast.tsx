import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type ToastTone = "ok" | "bad" | "info";

type ToastItem = { id: number; message: string; tone: ToastTone };

type Push = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<Push | null>(null);

let seq = 0;
let recent = { message: "", at: 0 };

// A short notice for something that just happened. It sits above the page so a form does not grow a status line.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((curr) => curr.filter((item) => item.id !== id));
  }, []);

  const push = useCallback<Push>(
    (message, tone = "info") => {
      const text = message.trim();
      if (!text) return;
      const now = Date.now();
      if (recent.message === text && now - recent.at < 500) return;
      recent = { message: text, at: now };
      const id = ++seq;
      setItems((curr) => [...curr, { id, message: text, tone }].slice(-3));
      const timer = window.setTimeout(() => dismiss(id), tone === "bad" ? 12000 : 6000);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) window.clearTimeout(timer);
    },
    [],
  );

  return (
    <ToastContext value={push}>
      {children}
      <div className="toast-slot">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`} role={item.tone === "bad" ? "alert" : "status"}>
            <span>{item.message}</span>
            <button className="text-link" type="button" onClick={() => dismiss(item.id)}>
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): Push {
  const push = use(ToastContext);
  if (!push) throw new Error("ToastProvider is missing");
  return push;
}
