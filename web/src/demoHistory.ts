// Synthetic history for the Kamla Sharma demo household only. Every screen that shows it says so.
// Shape follows the master plan's "family shift" seed: Day 2 and Day 12 quotes about Rahul.

export type Mood = "Good" | "Okay" | "Low";

export type DayRecord = {
  day: number;
  meals: number; // meals reported in conversation, 0 to 3
  minutes: number; // minutes Saathi and Kamla talked
  mood: Mood | null; // only when she said it
  familyContact: boolean; // she mentioned speaking with family that day
};

export const demoDays: DayRecord[] = [
  { day: 1, meals: 3, minutes: 6, mood: "Good", familyContact: true },
  { day: 2, meals: 3, minutes: 7, mood: "Good", familyContact: true },
  { day: 3, meals: 3, minutes: 5, mood: null, familyContact: true },
  { day: 4, meals: 2, minutes: 6, mood: "Okay", familyContact: false },
  { day: 5, meals: 3, minutes: 8, mood: "Good", familyContact: true },
  { day: 6, meals: 3, minutes: 6, mood: null, familyContact: true },
  { day: 7, meals: 3, minutes: 5, mood: "Okay", familyContact: false },
  { day: 8, meals: 3, minutes: 6, mood: null, familyContact: true },
  { day: 9, meals: 2, minutes: 4, mood: "Okay", familyContact: false },
  { day: 10, meals: 3, minutes: 5, mood: null, familyContact: false },
  { day: 11, meals: 2, minutes: 4, mood: "Low", familyContact: false },
  { day: 12, meals: 3, minutes: 5, mood: "Okay", familyContact: false },
  { day: 13, meals: 2, minutes: 3, mood: null, familyContact: false },
  { day: 14, meals: 3, minutes: 4, mood: "Okay", familyContact: false },
];

export type Highlight = { day: number; quote: string; english: string };

export const demoHighlights: Highlight[] = [
  { day: 2, quote: "Rahul roz phone karta hai.", english: "Rahul phones every day." },
  { day: 5, quote: "Aaj mandir gayi thi.", english: "I went to the temple today." },
  { day: 12, quote: "Pata nahi kahan hain, phone nahi utha rahe.", english: "I don't know where he is. He isn't picking up." },
];

export const demoConversationMemories = [
  { day: 4, text: "She waters the rose plant every morning." },
  { day: 6, text: "A neighbour visited in the evening." },
  { day: 9, text: "Correction: the rose plant is on the terrace, not the verandah." },
];
