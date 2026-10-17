import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { formatClock, formatDate, today } from "../../desk";

// Styled time and date pickers. The browser's own popups cannot be styled, so these replace them.
// Each keeps a hidden input with the same name and value format (HH:MM, YYYY-MM-DD), so forms read
// FormData exactly as before, and "required" still stops a submit.

function usePopover() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The popup is drawn on <body> (panels are CSS containers, which would trap it), placed under the field,
  // or above it when there is no room, and kept inside the window sideways.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = triggerRef.current?.getBoundingClientRect();
      if (!box) return;
      const height = popRef.current?.offsetHeight ?? 460;
      const room = window.innerHeight - 8;
      const below = box.bottom + 8;
      const above = box.top - 8 - height;
      // Below if it fits, else above if it fits, else as low as the window allows.
      const top = below + height <= room ? below : above >= 8 ? above : Math.max(8, room - height);
      const left = Math.max(8, Math.min(box.left, window.innerWidth - 348));
      setPos({ left, top });
    };
    place();
    // Measure again once the popup has drawn and its real height is known.
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target) && !popRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    // Focus the chosen value, or the first option, when the popup opens.
    const pop = popRef.current;
    (pop?.querySelector<HTMLElement>("[aria-pressed='true']") ?? pop?.querySelector<HTMLElement>("button"))?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return { open, setOpen, pos, wrapRef, popRef, triggerRef, close };
}

type Shell = {
  name: string;
  value: string;
  required?: boolean;
  label?: string;
  shown: string;
  placeholder: string;
  icon: ReactNode;
  popLabel: string;
  pop: ReturnType<typeof usePopover>;
  children: ReactNode;
};

function PickerShell({ name, value, required, label, shown, placeholder, icon, popLabel, pop, children }: Shell) {
  return (
    <span className="picker" ref={pop.wrapRef}>
      <button
        ref={pop.triggerRef}
        type="button"
        className={value ? "picker-trigger" : "picker-trigger picker-empty"}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        aria-label={label ? `${label}: ${value ? shown : "not set"}` : undefined}
        onClick={() => pop.setOpen((o) => !o)}
      >
        <span>{value ? shown : placeholder}</span>
        {icon}
      </button>
      {/* Carries the value for FormData and the browser's required check. */}
      <input
        className="picker-native"
        name={name}
        value={value}
        required={required}
        onChange={() => {}}
        onInvalid={() => pop.setOpen(true)}
        tabIndex={-1}
        aria-hidden="true"
      />
      {pop.open
        ? createPortal(
            <>
              <span className="picker-scrim" aria-hidden="true" onClick={pop.close} />
              <span ref={pop.popRef} className="picker-pop" style={pop.pos} role="dialog" aria-label={popLabel}>
                {children}
              </span>
            </>,
            document.body,
          )
        : null}
    </span>
  );
}

const clockIcon = (
  <svg className="picker-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const calendarIcon = (
  <svg className="picker-icon" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

const pad = (n: number) => String(n).padStart(2, "0");
const wrap = (n: number, size: number) => ((n % size) + size) % size;

// Scroll, drag, or arrow keys step a value by one. The wheel listener is not passive so the page does not scroll.
function useStepper(ref: React.RefObject<HTMLElement | null>, step: (delta: number) => void) {
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      acc += event.deltaY;
      if (Math.abs(acc) >= 40) {
        stepRef.current(acc > 0 ? 1 : -1);
        acc = 0;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);

  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      drag.current = { y: event.clientY, moved: false };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!drag.current) return;
      const dy = event.clientY - drag.current.y;
      if (Math.abs(dy) >= 26) {
        // Dragging down shows the earlier number, like turning a wheel.
        stepRef.current(dy > 0 ? -1 : 1);
        drag.current = { y: event.clientY, moved: true };
      }
    },
    onPointerUp: () => {
      drag.current = null;
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        stepRef.current(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        stepRef.current(-1);
      }
    },
  };
}

type WheelProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  show: (n: number) => string;
  active: boolean;
  onFocusUnit: () => void;
  onChange: (n: number) => void;
};

// One big number with its neighbours peeking above and below. Turning it rolls the column.
function NumberWheel({ label, value, min, max, show, active, onFocusUnit, onChange }: WheelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const size = max - min + 1;
  const [dir, setDir] = useState<"up" | "down" | "">("");
  const step = (delta: number) => {
    setDir(delta > 0 ? "up" : "down");
    onChange(min + wrap(value - min + delta, size));
    onFocusUnit();
  };
  const handlers = useStepper(ref, step);
  const prev = min + wrap(value - min - 1, size);
  const next = min + wrap(value - min + 1, size);
  return (
    <div
      ref={ref}
      className={active ? "wheel wheel-on" : "wheel"}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={show(value)}
      onClick={onFocusUnit}
      onFocus={onFocusUnit}
      {...handlers}
    >
      <span key={value} className={`wheel-col${dir ? ` wheel-${dir}` : ""}`} aria-hidden="true">
        <span className="wheel-peek">{show(next)}</span>
        <span className="wheel-now">{show(value)}</span>
        <span className="wheel-peek">{show(prev)}</span>
      </span>
    </div>
  );
}

type DialProps = {
  mode: "hour" | "minute";
  hour: number;
  minute: number;
  onHour: (h: number) => void;
  onMinute: (m: number, done: boolean) => void;
  onHourDone: () => void;
};

// A clock face. Tap or drag the hand; after the hour it moves on to minutes.
function Dial({ mode, hour, minute, onHour, onMinute, onHourDone }: DialProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const labels = mode === "hour" ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  const angle = mode === "hour" ? (hour % 12) * 30 : minute * 6;
  const exact = mode === "hour" ? true : minute % 5 === 0;
  const R = 38; // label ring radius, % of the face

  function fromPointer(event: React.PointerEvent, done: boolean) {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = event.clientX - (box.left + box.width / 2);
    const y = event.clientY - (box.top + box.height / 2);
    const deg = wrap((Math.atan2(x, -y) * 180) / Math.PI, 360);
    if (mode === "hour") {
      const h = Math.round(deg / 30) % 12;
      onHour(h === 0 ? 12 : h);
      if (done) onHourDone();
    } else {
      onMinute(Math.round(deg / 6) % 60, done);
    }
  }

  return (
    <div
      ref={ref}
      className="dial"
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        fromPointer(event, false);
      }}
      onPointerMove={(event) => {
        if (dragging.current) fromPointer(event, false);
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        fromPointer(event, true);
      }}
    >
      <span className="dial-hand" style={{ transform: `rotate(${angle}deg)` }} aria-hidden="true">
        <span className={exact ? "dial-tip" : "dial-tip dial-tip-dot"} />
      </span>
      <span className="dial-center" aria-hidden="true" />
      {labels.map((n, i) => {
        const a = (i * 30 * Math.PI) / 180;
        const on = mode === "hour" ? hour === n : minute === n;
        return (
          <button
            key={n}
            type="button"
            className={on ? "dial-num dial-num-on" : "dial-num"}
            style={{ left: `${50 + R * Math.sin(a)}%`, top: `${50 - R * Math.cos(a)}%` }}
            aria-pressed={on}
            aria-label={mode === "hour" ? `${n} o'clock` : `${pad(n)} minutes`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (mode === "hour") {
                onHour(n);
                onHourDone();
              } else onMinute(n, true);
            }}
          >
            {mode === "hour" ? n : pad(n)}
          </button>
        );
      })}
    </div>
  );
}

type TimeProps = { name: string; defaultValue?: string; required?: boolean; label?: string; placeholder?: string };

export function TimePicker({ name, defaultValue = "", required, label, placeholder = "Choose a time" }: TimeProps) {
  const [value, setValue] = useState(/^\d{2}:\d{2}$/.test(defaultValue) ? defaultValue : "");
  const pop = usePopover();
  // Changes stay a draft until Apply.
  const [draft, setDraft] = useState({ hour: 8, minute: 0, pm: false });
  const [mode, setMode] = useState<"hour" | "minute">("hour");

  useEffect(() => {
    if (!pop.open) return;
    if (value) {
      const [h, m] = value.split(":").map(Number);
      setDraft({ hour: h % 12 === 0 ? 12 : h % 12, minute: m, pm: h >= 12 });
    } else setDraft({ hour: 8, minute: 0, pm: false });
    setMode("hour");
  }, [pop.open, value]);

  function apply() {
    const h = (draft.hour % 12) + (draft.pm ? 12 : 0);
    setValue(`${pad(h)}:${pad(draft.minute)}`);
    pop.close();
  }

  return (
    <PickerShell
      name={name}
      value={value}
      required={required}
      label={label}
      shown={formatClock(value)}
      placeholder={placeholder}
      icon={clockIcon}
      popLabel={label ? `Choose ${label.toLowerCase()}` : "Choose a time"}
      pop={pop}
    >
      <span className="picker-title">{label ?? "Time"}</span>
      <span className="time-top">
        <NumberWheel
          label="Hour"
          value={draft.hour}
          min={1}
          max={12}
          show={String}
          active={mode === "hour"}
          onFocusUnit={() => setMode("hour")}
          onChange={(hour) => setDraft((d) => ({ ...d, hour }))}
        />
        <span className="time-colon" aria-hidden="true">
          <span />
          <span />
        </span>
        <NumberWheel
          label="Minute"
          value={draft.minute}
          min={0}
          max={59}
          show={pad}
          active={mode === "minute"}
          onFocusUnit={() => setMode("minute")}
          onChange={(minute) => setDraft((d) => ({ ...d, minute }))}
        />
        <span className="time-ampm" role="group" aria-label="Morning or evening">
          <button type="button" aria-pressed={!draft.pm} onClick={() => setDraft((d) => ({ ...d, pm: false }))}>
            AM
          </button>
          <button type="button" aria-pressed={draft.pm} onClick={() => setDraft((d) => ({ ...d, pm: true }))}>
            PM
          </button>
        </span>
      </span>
      <span className="time-hint">{mode === "hour" ? "Pick the hour" : "Now the minutes"} · scroll or drag the numbers</span>
      <Dial
        mode={mode}
        hour={draft.hour}
        minute={draft.minute}
        onHour={(hour) => setDraft((d) => ({ ...d, hour }))}
        onMinute={(minute) => setDraft((d) => ({ ...d, minute }))}
        onHourDone={() => setMode("minute")}
      />
      <span className="picker-actions">
        {value && !required ? (
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setValue("");
              pop.close();
            }}
          >
            Clear
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={pop.close}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={apply}>
          Apply
        </button>
      </span>
    </PickerShell>
  );
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function iso(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parse(value: string) {
  return new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
}

type DateProps = { name: string; defaultValue?: string; required?: boolean; min?: string; label?: string };

export function DatePicker({ name, defaultValue = "", required, min, label }: DateProps) {
  const [value, setValue] = useState(/^\d{4}-\d{2}-\d{2}$/.test(defaultValue) ? defaultValue : "");
  const pop = usePopover();
  const now = today();
  const tomorrow = iso(new Date(Date.now() + 86_400_000));
  const [draft, setDraft] = useState(value || now);
  const [month, setMonth] = useState(() => {
    const d = parse(value || now);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [dir, setDir] = useState<"up" | "down" | "">("");
  const gridRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!pop.open) return;
    const start = value || (min && min > now ? min : now);
    setDraft(start);
    const d = parse(start);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    setDir("");
  }, [pop.open, value, min, now]);

  const minMonth = min ? new Date(parse(min).getFullYear(), parse(min).getMonth(), 1) : null;
  const atMin = minMonth ? month <= minMonth : false;

  function shift(delta: number) {
    if (delta < 0 && atMin) return;
    setDir(delta > 0 ? "up" : "down");
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  // Scrolling over the month or the days turns the month.
  useStepper(gridRef, shift);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const blanks = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(blanks).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const d = parse(draft);

  function choose(next: string) {
    setDraft(next);
    const p = parse(next);
    setMonth(new Date(p.getFullYear(), p.getMonth(), 1));
  }

  return (
    <PickerShell
      name={name}
      value={value}
      required={required}
      label={label}
      shown={value ? formatDate(value) : ""}
      placeholder="Choose a date"
      icon={calendarIcon}
      popLabel={label ? `Choose ${label.toLowerCase()}` : "Choose a date"}
      pop={pop}
    >
      <span className="picker-title">{label ?? "Date"}</span>
      <span className="date-top">
        <span className="date-day">{d.toLocaleDateString(undefined, { weekday: "long" })}</span>
        <span className="date-big">{d.toLocaleDateString(undefined, { day: "numeric", month: "long" })}</span>
        <span className="date-year">{d.getFullYear()}</span>
      </span>
      <span className="picker-quick">
        <button type="button" aria-pressed={draft === now} onClick={() => choose(now)}>
          Today
        </button>
        <button type="button" aria-pressed={draft === tomorrow} onClick={() => choose(tomorrow)}>
          Tomorrow
        </button>
      </span>
      <span ref={gridRef} className="date-scroll">
        <span className="picker-month">
          <button type="button" className="picker-nav" aria-label="Previous month" disabled={atMin} onClick={() => shift(-1)}>
            ‹
          </button>
          <strong aria-live="polite">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
          <button type="button" className="picker-nav" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </button>
        </span>
        <span key={iso(month)} className={`picker-cal${dir ? ` cal-${dir}` : ""}`} role="group" aria-label="Days">
          {WEEKDAYS.map((w) => (
            <span key={w} className="picker-dow" aria-hidden="true">
              {w}
            </span>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <span key={`b${i}`} />;
            const date = iso(new Date(month.getFullYear(), month.getMonth(), day));
            return (
              <button
                key={date}
                type="button"
                className={date === now ? "picker-today" : undefined}
                aria-pressed={draft === date}
                aria-label={formatDate(date)}
                disabled={Boolean(min && date < min)}
                onClick={() => setDraft(date)}
              >
                {day}
              </button>
            );
          })}
        </span>
      </span>
      <span className="picker-actions">
        <button type="button" className="ghost" onClick={pop.close}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={Boolean(min && draft < min)}
          onClick={() => {
            setValue(draft);
            pop.close();
          }}
        >
          Apply
        </button>
      </span>
    </PickerShell>
  );
}
