/**
 * On-phone distress check.
 *
 * A word list runs with no network and can offer 112. The badge may name a browser
 * model only when Chrome's built-in language model actually returns an answer.
 * WebGPU being present is not that model.
 */

export interface EdgeGemmaAssessment {
  isEmergency: boolean;
  suggestedAction?: "call_112" | "call_108" | "elderline" | "none";
  confidence: number;
  offlineReady: boolean;
  engine: "edge-gemma-builtin" | "edge-gemma-webgpu" | "heuristic-fallback";
}

// Emergency distress keywords in Indian context
const EMERGENCY_KEYWORDS = [
  "gir", "slip", "fall", "gir gaya", "gir gayi",
  "dard", "pain", "chest", "sine mein dard", "seene mein",
  "saans", "breath", "chakkar", "unconscious", "behosh",
  "madad", "help", "bachao", "bleeding", "chot",
];

/**
 * True only when Chrome's built-in language model reports it can answer.
 */
export async function isEdgeGemmaAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  // Check for Chrome Built-in AI (Prompt API)
  if ("ai" in window && "languageModel" in (window as any).ai) {
    try {
      const capabilities = await (window as any).ai.languageModel.capabilities();
      return capabilities.available === "readily" || capabilities.available === "after-download";
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Evaluates spoken phrases locally on the edge device to detect critical distress
 * without requiring cloud server roundtrips.
 */
export async function evaluateEdgeGemmaDistress(phrase: string): Promise<EdgeGemmaAssessment> {
  const normalized = (phrase || "").toLowerCase();
  
  // 1. Try Chrome Built-in Prompt API if present
  if (typeof window !== "undefined" && "ai" in window && "languageModel" in (window as any).ai) {
    try {
      const session = await (window as any).ai.languageModel.create({
        systemPrompt: "You classify a spoken line from an older adult in India. Respond strictly in JSON: {\"emergency\": boolean, \"action\": \"call_112\" | \"call_108\" | \"none\"}",
      });
      const raw = await session.prompt(`Classify: "${phrase}"`);
      const parsed = JSON.parse(raw);
      return {
        isEmergency: Boolean(parsed.emergency),
        suggestedAction: parsed.action || "call_112",
        confidence: 0.95,
        offlineReady: true,
        engine: "edge-gemma-builtin",
      };
    } catch {
      // Fallback to local on-device heuristics
    }
  }

  // 2. High-speed local edge keyword reasoning
  const matches = EMERGENCY_KEYWORDS.filter((kw) => normalized.includes(kw));
  const isEmergency = matches.length > 0;

  return {
    isEmergency,
    suggestedAction: isEmergency ? "call_112" : "none",
    confidence: isEmergency ? 0.9 : 0.2,
    offlineReady: true,
    engine: "heuristic-fallback",
  };
}
