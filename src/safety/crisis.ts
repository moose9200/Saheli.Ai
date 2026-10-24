/**
 * Crisis detection.
 *
 * Design rules, non-negotiable:
 *  1. This is a triage signal, not a diagnosis. It decides whether to surface
 *     help, never what is wrong with the person.
 *  2. False positives are cheap; false negatives are not. Ambiguity escalates.
 *  3. Detection works on the *user's* words in the script they actually typed.
 *     An English-only keyword list silently fails the people most at risk.
 *  4. Helplines are factual and must stay current — verify before release.
 *
 * Verified Indian helplines (national, free, 24x7 unless noted):
 *   Tele-MANAS        14416 / 1-800-891-4416   mental health
 *   KIRAN             1800-599-0019            mental health, 13 languages
 *   Emergency         112                      police/fire/ambulance
 *   Women's Helpline  181                      women in distress
 *   Childline         1098                     children
 */

export type RiskLevel = "none" | "watch" | "urgent";

export interface CrisisSignal {
  level: RiskLevel;
  categories: CrisisCategory[];
  /** What to say next. Never diagnostic. */
  reply: string | null;
  helplines: Helpline[];
}

export type CrisisCategory =
  | "self-harm"
  | "domestic-abuse"
  | "medical-emergency"
  | "financial-coercion"
  | "child-safety";

export interface Helpline {
  name: string;
  number: string;
  note: string;
}

const HELPLINES: Record<CrisisCategory, Helpline[]> = {
  "self-harm": [
    { name: "Tele-MANAS", number: "14416", note: "Government of India, free, 24x7" },
    { name: "KIRAN", number: "1800-599-0019", note: "Free, 13 Indian languages" },
  ],
  "domestic-abuse": [
    { name: "Women's Helpline", number: "181", note: "Free, 24x7" },
    { name: "Emergency", number: "112", note: "Immediate danger" },
  ],
  "medical-emergency": [
    { name: "Emergency", number: "112", note: "Ambulance, police, fire" },
  ],
  "financial-coercion": [
    { name: "Cyber Crime Helpline", number: "1930", note: "Financial fraud, freeze transactions" },
    { name: "Emergency", number: "112", note: "Immediate danger" },
  ],
  "child-safety": [
    { name: "Childline", number: "1098", note: "Free, 24x7" },
    { name: "Emergency", number: "112", note: "Immediate danger" },
  ],
};

/**
 * Keywords, grouped by category and spread across scripts.
 *
 * Deliberately overlapping stems rather than exact phrases: Indian languages are
 * agglutinative, so "मरना" must also catch "मर जाऊंगा", "मरना चाहता", and Hindi
 * speakers type in Latin script constantly ("marna", "jeena nahi").
 */
const PATTERNS: Array<{ category: CrisisCategory; level: RiskLevel; terms: string[] }> = [
  {
    category: "self-harm",
    level: "urgent",
    terms: [
      // Devanagari
      "आत्महत्या", "खुदकुशी", "मरना चाहता", "मरना चाहती", "जीना नहीं", "जीने का मन नहीं",
      "खुद को मार", "अपनी जान", "फांसी", "ज़हर खा", "जहर खा",
      // Latin transliteration / Hinglish
      "suicide", "atmahatya", "khudkhushi", "marna chahta", "marna chahti",
      "jeena nahi", "jeene ka mann nahi", "khud ko maar", "apni jaan", "khatam kar doon",
      // Other scripts
      "தற்கொலை", "ఆత్మహత్య", "আত্মহত্যা", "आत्महत्या कर",
    ],
  },
  {
    category: "domestic-abuse",
    level: "urgent",
    terms: [
      "मारता है", "मारती है", "मारपीट", "घरेलू हिंसा", "दहेज", "जबरदस्ती करता",
      "maarta hai", "maarti hai", "maarpeet", "ghar me maar", "dahej", "zabardasti karta",
      "கொடுமை", "కొడతాడు", "মারধর", "गाली देता",
    ],
  },
  {
    category: "medical-emergency",
    level: "urgent",
    terms: [
      "सांस नहीं आ", "सीने में दर्द", "छाती में दर्द", "बेहोश", "खून बह", "दौरा पड़",
      "saans nahi aa", "seene me dard", "chhati me dard", "behosh", "khoon beh", "daura",
      "மூச்சு வர", "ఊపిరి", "শ্বাস",
    ],
  },
  {
    category: "financial-coercion",
    level: "watch",
    terms: [
      "otp मांग", "ओटीपी मांग", "पैसे भेज दो", "खाता खाली", "ठग", "धोखा",
      "otp maang", "paise bhej do", "khata khali", "thag", "dhokha", "fraud hua",
    ],
  },
  {
    category: "child-safety",
    level: "urgent",
    terms: ["बच्चे को मार", "bacche ko maar", "child abuse", "बच्ची के साथ"],
  },
];

/**
 * Co-occurrence rules.
 *
 * Phrase matching misses the commonest Indian-language construction, because
 * negation floats: "जीना नहीं चाहती", "अब और नहीं जीना", "jeena nahi hai" are the
 * same statement with the verb in three different places. A phrase list passed
 * one of these and failed another in test — which is exactly the false negative
 * this file exists to prevent. So: a life/death stem plus a negation anywhere in
 * the utterance counts, regardless of order.
 */
const COOCCURRENCE: Array<{
  category: CrisisCategory;
  level: RiskLevel;
  /** Any one of these... */
  stems: string[];
  /** ...plus any one of these. */
  negations: string[];
}> = [
  {
    category: "self-harm",
    level: "urgent",
    stems: ["मरना", "मर जा", "मरूं", "मरूँ", "खत्म कर", "ख़त्म कर", "marna", "mar ja", "mar jaana", "khatam kar"],
    negations: ["चाह", "सोच", "chahta", "chahti", "soch"],
  },
  {
    category: "self-harm",
    level: "urgent",
    stems: ["जीना", "जीने", "जिंदा", "जीवन", "jeena", "jeene", "zinda", "jeevan"],
    negations: ["नहीं", "नही", "nahi", "nahin"],
  },
];

export function detectCrisis(text: string): CrisisSignal {
  const haystack = text.toLowerCase();
  const found = new Map<CrisisCategory, RiskLevel>();

  for (const rule of PATTERNS) {
    if (rule.terms.some((term) => haystack.includes(term.toLowerCase()))) {
      const previous = found.get(rule.category);
      if (previous !== "urgent") found.set(rule.category, rule.level);
    }
  }

  for (const rule of COOCCURRENCE) {
    const hasStem = rule.stems.some((s) => haystack.includes(s));
    const hasNegation = rule.negations.some((n) => haystack.includes(n));
    const previous = found.get(rule.category);
    if (hasStem && hasNegation && previous !== "urgent") found.set(rule.category, rule.level);
  }

  if (found.size === 0) {
    return { level: "none", categories: [], reply: null, helplines: [] };
  }

  const categories = [...found.keys()];
  const level: RiskLevel = [...found.values()].includes("urgent") ? "urgent" : "watch";
  const helplines = categories.flatMap((c) => HELPLINES[c]);

  return { level, categories, reply: buildReply(level, categories), helplines };
}

/**
 * The reply does three things and nothing else: acknowledges, offers help,
 * gives a number. It does not diagnose, does not promise confidentiality it
 * cannot keep, and does not lecture.
 */
function buildReply(level: RiskLevel, categories: CrisisCategory[]): string {
  if (level === "urgent") {
    const who = categories.includes("child-safety") ? "a child"
      : categories.includes("domestic-abuse") ? "someone at home"
      : categories.includes("medical-emergency") ? "a medical emergency"
      : "what you are carrying";
    return `I'm here, and I'm glad you told me. I'm not able to help with ${who} on my own — please talk to someone who can, right now.`;
  }
  return "That sounds like it could be a scam or someone pressuring you. Please don't share any OTP or PIN, and talk to someone you trust before sending money.";
}

/** Helplines for the UI to render as tappable buttons. */
export function allHelplines(): Helpline[] {
  const seen = new Set<string>();
  return Object.values(HELPLINES).flat().filter((h) => {
    if (seen.has(h.number)) return false;
    seen.add(h.number);
    return true;
  });
}
