import type { ReminderKind } from "../desk";

// A line copied from a page, before it becomes a reminder the caretaker can tick.
export type PageRoutineLike = {
  kind?: string;
  name: string;
  dose?: string;
  schedule?: string;
  time?: string;
  note?: string;
};

export type SuggestedReminder = {
  id: string;
  on: boolean;
  kind: ReminderKind;
  name: string;
  dose: string;
  schedule: "Once" | "Daily";
  date: string;
  time: string;
  note: string;
  hint: string;
};

const KINDS = new Set<ReminderKind>(["medicine", "exercise", "call", "meal", "other"]);

function stamp(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

function shift(now: Date, days: number, months: number): string {
  const next = new Date(now.getFullYear(), now.getMonth() + months, now.getDate() + days);
  return stamp(next);
}

function clock(value: string | undefined): string {
  return value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : "";
}

// Brushing and flossing stay habits. A filling or a cleaning is one visit, never a daily reminder.
export function suggestReminders(routines: PageRoutineLike[], now = new Date()): SuggestedReminder[] {
  const out: SuggestedReminder[] = [];
  routines.forEach((routine, index) => {
    const name = routine.name.trim();
    if (!name) return;
    const blob = `${name} ${routine.note ?? ""} ${routine.schedule ?? ""}`.toLowerCase();
    const printed = clock(routine.time);
    const visit = /cavity|filling|cleaning|appointment|dentist|checkup|check-up/.test(blob);
    const months = /six month|6 month|every six/.test(blob) ? 6 : /twelve month|12 month|every year|yearly/.test(blob) ? 12 : 0;
    const twice = /twice|two times|2 times|do baar|दो बार/.test(blob);
    const givenKind = KINDS.has(routine.kind as ReminderKind) ? (routine.kind as ReminderKind) : "other";
    const habit = /walk|yoga|stretch/.test(blob) ? "exercise" : /meal|breakfast|lunch|dinner|food/.test(blob) ? "meal" : givenKind;
    const kind: ReminderKind = givenKind === "medicine" && routine.dose?.trim() && !visit ? "medicine" : habit === "medicine" ? "other" : habit;

    if (visit || months) {
      out.push({
        id: `page-${index}`,
        on: true,
        kind: "other",
        name,
        dose: "",
        schedule: "Once",
        date: months ? shift(now, 0, months) : shift(now, 7, 0),
        time: printed || "10:00",
        note: (routine.note ?? "").trim(),
        hint: months
          ? "The page says this every few months, so this is one reminder. The date and time are a suggestion."
          : "The page names a visit, not something for every day. The date and time are a suggestion.",
      });
      return;
    }

    if (twice) {
      const times = printed ? [printed, printed === "20:00" ? "08:00" : "20:00"] : ["08:00", "20:00"];
      times.forEach((time, slot) => {
        out.push({
          id: `page-${index}-${slot}`,
          on: true,
          kind,
          name,
          dose: kind === "medicine" ? (routine.dose ?? "").trim() : "",
          schedule: "Daily",
          date: "",
          time,
          note: (routine.note ?? "").trim(),
          hint: printed && slot === 0 ? "This time is on the page." : "Twice a day was written. This clock time is a suggestion.",
        });
      });
      return;
    }

    const once = /\bonce\b/.test(blob) && !/once a day|once daily|once every day/.test(blob);
    out.push({
      id: `page-${index}`,
      on: true,
      kind,
      name,
      dose: kind === "medicine" ? (routine.dose ?? "").trim() : "",
      schedule: once ? "Once" : "Daily",
      date: once ? shift(now, 1, 0) : "",
      time: printed || "08:00",
      note: (routine.note ?? "").trim(),
      hint: printed ? "This time is on the page." : "No clock time was on the page. This one is a suggestion.",
    });
  });
  return out.slice(0, 8);
}
