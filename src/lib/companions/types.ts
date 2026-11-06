/** The words the page shows. Safe to send to the browser. */
export interface CompanionCopy {
  id: CompanionId;
  name: string;
  /** The big line on the start screen, sign-in page and link preview. */
  tagline: string;
  /** The small line under it on the start screen. */
  subtitle: string;
  /** Start screen, under the name: "Your travel advisor". Display only. */
  role: string;
  /** Start screen, under the role: a short introduction. Display only. */
  intro: string;
  placeholder: string;
  placeholderWithPhotos: string;
  status: { thinking: string; looking: string; searching: string };
  /** How Listen reads this advisor's answers aloud. */
  voice: VoiceProfile;
}

/**
 * The voice an advisor reads with, chosen from the voices on the person's own
 * device: no voice service is called. The first preferred name the device
 * has wins; otherwise the closest voice by accent and gender.
 */
export interface VoiceProfile {
  /** Voice names to look for, best first (e.g. "Daniel", "Google UK English Male"). */
  preferred: string[];
  /** The English accent to fall back to, as a language tag: "en-GB", "en-US", "en-AU". */
  lang: string;
  gender: "female" | "male";
  /** Speaking speed, 1 is normal. */
  rate: number;
  /** 1 is the voice's own pitch. */
  pitch: number;
  /**
   * The natural voice this advisor reads with when ElevenLabs is set up
   * (ELEVENLABS_API_KEY on the deployment); otherwise the device voice above.
   * The voice must be in the ElevenLabs account's My Voices.
   */
  natural: {
    /** ElevenLabs voice id. */
    voiceId: string;
    /** Its name in the ElevenLabs Voice Library, to find it there. */
    name: string;
    /** 0–1: lower is more expressive, higher is steadier. */
    stability: number;
    /** 0–1: how much of the voice's own style to bring out. */
    style: number;
  };
}

// "jack" stays known so his old deployment shows that he has retired, rather
// than another advisor or Gio. The active lineup is ACTIVE_LINEUP in index.ts.
export type CompanionId = "gio" | "tony" | "martini" | "alden" | "goldie" | "jack";

/** One character on the shared engine: what it's told, and how it looks. */
export interface Companion extends CompanionCopy {
  systemPrompt: string;
  /** Lines of the app capabilities block, with and without web search. */
  capabilities: (webSearch: boolean) => string[];
  /** What the model is told when photos arrive with no question. */
  photosOnly: (count: number) => string;
  /** Web searches per answer unless WEB_SEARCH_MAX_USES says otherwise. */
  webSearchMaxUses: number;
  /** Background of the app icon. */
  iconTile: string;
  /** One-line description for the link preview and home screen. */
  description: string;
  /**
   * No longer in Cinq's lineup. Kept, under its own name, so an old link shows
   * that this advisor has retired; it answers no new questions.
   */
  retired?: boolean;
}
