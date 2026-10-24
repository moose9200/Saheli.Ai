/**
 * Indic language + dialect registry.
 *
 * The unit of design here is the *dialect profile*, not the language. "Hindi" is
 * not a voice: a Delhi 24-year-old, a Marwari grandmother in Jodhpur and a
 * Bhojpuri speaker in Chhapra are three different products as far as the ear is
 * concerned. Every profile is compiled by each speech provider into whatever
 * that provider can actually control (see `src/speech/`).
 *
 * FIDELITY NOTE — read before editing.
 * A profile can only persuade a general-purpose TTS model. It cannot manufacture
 * a dialect the model never heard. The honest fidelity ladder is:
 *   1. a native speaker's recorded voice, used with consent (highest)
 *   2. a model with a protected native voice for that language (Indic-Speak)
 *   3. prompt-directed accent on a general model (Gemini 3.8 TTS)
 *   4. browser Web Speech (fallback, never the product)
 * Profiles below are tier 3 material. Each one is `reviewedBy: null` until a
 * native speaker has listened and signed off — that is an eval gate, not a
 * comment. Do not ship a profile as "authentic" while `reviewedBy` is null.
 */

export type LanguageCode =
  | "hi" | "mr" | "ta" | "te" | "bn" | "gu" | "kn" | "ml"
  | "pa" | "or" | "as" | "ur" | "ne" | "sa" | "mai" | "bho" | "raj" | "en";

export interface Language {
  code: LanguageCode;
  /** English name */
  name: string;
  /** Endonym, in its own script */
  nativeName: string;
  script: string;
  rtl: boolean;
  /** Eighth Schedule of the Indian Constitution */
  eighthSchedule: boolean;
  /** Gemini TTS language tag, when the model accepts one */
  bcp47: string;
  /** Language names that actually appear for this language in Indic-Speak */
  indicSpeakVoices?: readonly string[];
}

export const LANGUAGES: Readonly<Record<LanguageCode, Language>> = {
  hi: { code: "hi", name: "Hindi", nativeName: "हिन्दी", script: "Devanagari", rtl: false, eighthSchedule: true, bcp47: "hi-IN", indicSpeakVoices: ["Kavya", "Amit"] },
  mr: { code: "mr", name: "Marathi", nativeName: "मराठी", script: "Devanagari", rtl: false, eighthSchedule: true, bcp47: "mr-IN", indicSpeakVoices: ["Anagha", "Chinmay"] },
  ta: { code: "ta", name: "Tamil", nativeName: "தமிழ்", script: "Tamil", rtl: false, eighthSchedule: true, bcp47: "ta-IN", indicSpeakVoices: ["Anitha", "Arun"] },
  te: { code: "te", name: "Telugu", nativeName: "తెలుగు", script: "Telugu", rtl: false, eighthSchedule: true, bcp47: "te-IN", indicSpeakVoices: ["Sravani", "Vamsi"] },
  bn: { code: "bn", name: "Bengali", nativeName: "বাংলা", script: "Bengali", rtl: false, eighthSchedule: true, bcp47: "bn-IN", indicSpeakVoices: ["Ishita", "Sourav"] },
  gu: { code: "gu", name: "Gujarati", nativeName: "ગુજરાતી", script: "Gujarati", rtl: false, eighthSchedule: true, bcp47: "gu-IN", indicSpeakVoices: ["Dhara", "Parth"] },
  kn: { code: "kn", name: "Kannada", nativeName: "ಕನ್ನಡ", script: "Kannada", rtl: false, eighthSchedule: true, bcp47: "kn-IN", indicSpeakVoices: ["Deepika", "Adarsh"] },
  ml: { code: "ml", name: "Malayalam", nativeName: "മലയാളം", script: "Malayalam", rtl: false, eighthSchedule: true, bcp47: "ml-IN", indicSpeakVoices: ["Lakshmi", "Kiran"] },
  pa: { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", script: "Gurmukhi", rtl: false, eighthSchedule: true, bcp47: "pa-IN", indicSpeakVoices: ["Kaur", "Manpreet"] },
  or: { code: "or", name: "Odia", nativeName: "ଓଡ଼ିଆ", script: "Odia", rtl: false, eighthSchedule: true, bcp47: "or-IN", indicSpeakVoices: ["Itishree", "Akash"] },
  as: { code: "as", name: "Assamese", nativeName: "অসমীয়া", script: "Bengali-Assamese", rtl: false, eighthSchedule: true, bcp47: "as-IN", indicSpeakVoices: ["Prastuti", "Ankur"] },
  ur: { code: "ur", name: "Urdu", nativeName: "اُردُو", script: "Arabic (Nastaliq)", rtl: true, eighthSchedule: true, bcp47: "ur-IN", indicSpeakVoices: ["Saba", "Zaid"] },
  ne: { code: "ne", name: "Nepali", nativeName: "नेपाली", script: "Devanagari", rtl: false, eighthSchedule: true, bcp47: "ne-IN", indicSpeakVoices: ["Srijana", "Sagar"] },
  sa: { code: "sa", name: "Sanskrit", nativeName: "संस्कृतम्", script: "Devanagari", rtl: false, eighthSchedule: true, bcp47: "sa-IN", indicSpeakVoices: ["Bharati", "Aryaman"] },
  mai: { code: "mai", name: "Maithili", nativeName: "मैथिली", script: "Devanagari", rtl: false, eighthSchedule: true, bcp47: "hi-IN", indicSpeakVoices: ["Vaidehi", "Madhukar"] },
  bho: { code: "bho", name: "Bhojpuri", nativeName: "भोजपुरी", script: "Devanagari", rtl: false, eighthSchedule: false, bcp47: "hi-IN", indicSpeakVoices: [] },
  raj: { code: "raj", name: "Rajasthani (Marwari)", nativeName: "मारवाड़ी", script: "Devanagari", rtl: false, eighthSchedule: false, bcp47: "hi-IN", indicSpeakVoices: [] },
  en: { code: "en", name: "Indian English", nativeName: "English (India)", script: "Latin", rtl: false, eighthSchedule: false, bcp47: "en-IN" },
};

/** How the speaker should treat English words inside an Indic sentence. */
export type CodeMixPolicy =
  | "preserve-natural" // say the English word in an Indian-English accent, no translation
  | "transliterate"    // render it in the local script, same sound
  | "prefer-native";   // substitute the native word when one exists in common use

export interface DialectProfile {
  id: string;
  language: LanguageCode;
  /** What a user would call it */
  label: string;
  /** Geographic + social grounding. Provenance for the accent claim. */
  region: string;
  speakerPersona: string;
  /**
   * Accent / tone / pitch / pace, stated the way you would describe a real
   * person to a voice actor. Providers that accept a style prompt use this
   * verbatim; providers with fixed voices use it only for validation.
   */
  style: string;
  /** Baseline pitch target, relative to the voice's own centre. */
  pitch: "low" | "natural" | "warm" | "bright";
  /** Syllables per second target, from observed natural speech. */
  pace: number;
  codeMix: CodeMixPolicy;
  /** Words and morphology that make the dialect recognisable. */
  lexicon: string[];
  /** Register markers the model must reach for. */
  addressForms: string[];
  /** Things a well-meaning model does that instantly reads as foreign. */
  avoid: string[];
  /** Native speaker who has listened and approved this profile. */
  reviewedBy: string | null;
}

/**
 * Profiles are deliberately few and deep. Adding a language is easy; making a
 * dialect convincing is not, and a profile nobody native has heard is worse
 * than no profile at all.
 */
export const DIALECTS: Readonly<Record<string, DialectProfile>> = {
  "hi-in-standard": {
    id: "hi-in-standard",
    language: "hi",
    label: "Hindi · neutral",
    region: "Pan-India, broadcast register",
    speakerPersona: "A calm, well-read woman in her thirties from Lucknow.",
    style:
      "Speak in clear, unhurried standard Hindi with a north-Indian accent. Even, warm intonation; " +
      "falling contours on statements; slight lift only at genuine questions. No news-anchor stiffness, " +
      "no sing-song. Keep consonants crisp and vowels full.",
    pitch: "natural",
    pace: 4.2,
    codeMix: "preserve-natural",
    lexicon: ["जी", "अच्छा", "ठीक है", "बिलकुल"],
    addressForms: ["आप"],
    avoid: ["textbook Sanskritised vocabulary", "English word order inside a Hindi sentence", "robotic equal stress on every syllable"],
    reviewedBy: null,
  },
  "hi-in-delhi": {
    id: "hi-in-delhi",
    language: "hi",
    label: "Hinglish · Delhi NCR",
    region: "Delhi, Noida, Gurugram — urban under-40",
    speakerPersona: "A quick, friendly Delhi woman in her late twenties who switches between Hindi and English mid-sentence without noticing.",
    style:
      "Speak Hinglish the way urban Delhi actually does: Hindi grammar carrying English content words, " +
      "fast and light, rising-falling contours, a relaxed drawl on sentence endings. Never pause to " +
      "announce the language switch — it is one stream of speech.",
    pitch: "bright",
    pace: 5.0,
    codeMix: "preserve-natural",
    lexicon: ["बस", "मतलब", "है ना", "अच्छा सुनो", "चलो ठीक है"],
    addressForms: ["आप", "तुम"],
    avoid: ["translating the English words", "formal शुद्ध हिन्दी", "over-enunciating English terms"],
    reviewedBy: null,
  },
  "hi-in-marwari": {
    id: "hi-in-marwari",
    language: "raj",
    label: "Marwari · Jodhpur",
    region: "Western Rajasthan, Marwar belt",
    speakerPersona: "A warm, unhurried woman in her fifties from Jodhpur, speaking to family.",
    style:
      "Speak Marwari with a Rajasthani accent: retroflex consonants, drawn-out final vowels, " +
      "a falling-then-level contour that lands softly rather than sharply. Intimate, unhurried, " +
      "the way one speaks at home rather than to a stranger.",
    pitch: "warm",
    pace: 3.8,
    codeMix: "prefer-native",
    lexicon: ["म्हारो", "म्हारी", "थे", "छे", "कनै", "बात करो", "घणो"],
    addressForms: ["थे", "तम"],
    avoid: ["standard Hindi के/है endings", "Delhi intonation", "Sanskritised vocabulary"],
    reviewedBy: null,
  },
  "hi-in-bhojpuri": {
    id: "hi-in-bhojpuri",
    language: "bho",
    label: "Bhojpuri · Purvanchal",
    region: "Eastern UP and Bihar — Chhapra, Ballia, Gorakhpur",
    speakerPersona: "A cheerful woman in her forties from Chhapra, talking to a neighbour.",
    style:
      "Speak Bhojpuri with a Purvanchal accent: rising melodic endings, emphatic consonant " +
      "clusters, generous vowel length. Open and direct, with the easy rhythm of conversation " +
      "between people who know each other.",
    pitch: "bright",
    pace: 4.0,
    codeMix: "prefer-native",
    lexicon: ["बा", "बाटे", "हमरा", "रउरा", "कइसे", "काहे", "अबहीं"],
    addressForms: ["रउरा", "तोंहर"],
    avoid: ["standard Hindi है/था", "flat meter", "formal register"],
    reviewedBy: null,
  },
  "mr-in-pune": {
    id: "mr-in-pune",
    language: "mr",
    label: "Marathi · Pune",
    region: "Pune, western Maharashtra",
    speakerPersona: "An even-tempered woman in her thirties from Pune.",
    style:
      "Speak standard Marathi with a Pune accent: clipped, precise consonants, relatively level " +
      "pitch with short falls at clause ends. Direct and unornamented; warmth carried by pace, not by pitch.",
    pitch: "natural",
    pace: 4.4,
    codeMix: "preserve-natural",
    lexicon: ["बरं", "हो", "नक्की", "अगं", "चला"],
    addressForms: ["तुम्ही"],
    avoid: ["Hindi intonation", "over-rounded vowels", "Sanskritised formal register"],
    reviewedBy: null,
  },
  "ta-in-chennai": {
    id: "ta-in-chennai",
    language: "ta",
    label: "Tamil · Chennai",
    region: "Chennai, northern Tamil Nadu",
    speakerPersona: "A composed woman in her thirties from Chennai.",
    style:
      "Speak Tamil with a Chennai accent: crisp retroflex ḻ/ṇ, short clear vowels, even pace with a " +
      "gentle fall at the end of each clause. Avoid the elongated musical drawl of film dialogue.",
    pitch: "natural",
    pace: 4.6,
    codeMix: "preserve-natural",
    lexicon: ["சரி", "ஆமா", "பாருங்க", "இல்ல", "நல்லா"],
    addressForms: ["நீங்கள்"],
    avoid: ["Sanskritised formal Tamil", "singing intonation", "English sentence order"],
    reviewedBy: null,
  },
  "te-in-standard": {
    id: "te-in-standard",
    language: "te",
    label: "Telugu · standard",
    region: "Andhra Pradesh / Telangana coastal and inland",
    speakerPersona: "A gentle woman in her thirties speaking to an elder.",
    style:
      "Speak Telugu with a neutral Andhra accent: soft consonants, rounded vowels, a flowing rhythm " +
      "with light stress. Respectful and calm, never clipped.",
    pitch: "warm",
    pace: 4.2,
    codeMix: "preserve-natural",
    lexicon: ["సరే", "అవును", "చెప్పండి", "బాగుంది"],
    addressForms: ["మీరు"],
    avoid: ["Hyderabad Deccani inflection when aiming for Andhra", "flat monotone", "over-formal literary Telugu"],
    reviewedBy: null,
  },
  "bn-in-kolkata": {
    id: "bn-in-kolkata",
    language: "bn",
    label: "Bengali · Kolkata",
    region: "Kolkata, West Bengal",
    speakerPersona: "An articulate woman in her forties from south Kolkata.",
    style:
      "Speak Bengali with a Kolkata accent: soft 'a' vowels, gentle stress, a slight rise mid-clause " +
      "and a soft landing at the end. Conversational, never declamatory.",
    pitch: "warm",
    pace: 4.3,
    codeMix: "preserve-natural",
    lexicon: ["আচ্ছা", "ঠিক আছে", "বলুন", "হ্যাঁ"],
    addressForms: ["আপনি"],
    avoid: ["Bangladeshi news-reader cadence when the user is Indian", "hard consonant attack", "syllable-timed delivery"],
    reviewedBy: null,
  },
  "en-in-indian": {
    id: "en-in-indian",
    language: "en",
    label: "Indian English",
    region: "Pan-India",
    speakerPersona: "A clear-spoken Indian woman in her thirties.",
    style:
      "Speak Indian English: syllable-timed rather than stress-timed, retroflex t/d, " +
      "full vowels, even pace. Not British, not American.",
    pitch: "natural",
    pace: 4.4,
    codeMix: "preserve-natural",
    lexicon: [],
    addressForms: [],
    avoid: ["American rhoticity", "British clipped vowels", "fake neutral mid-Atlantic accent"],
    reviewedBy: null,
  },
};

export const DEFAULT_DIALECT = "hi-in-standard";

export function getDialect(id: string | undefined): DialectProfile {
  if (id && DIALECTS[id]) return DIALECTS[id];
  return DIALECTS[DEFAULT_DIALECT]!;
}

export function dialectsForLanguage(language: LanguageCode): DialectProfile[] {
  return Object.values(DIALECTS).filter((d) => d.language === language);
}

/** Profiles that a native speaker has actually approved. Empty today, by design. */
export function approvedDialects(): DialectProfile[] {
  return Object.values(DIALECTS).filter((d) => d.reviewedBy !== null);
}
