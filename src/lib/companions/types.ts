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
   * On the C2 architecture, this advisor's own safety boundary in place of the
   * shared one (Goldie's). Unused on the current architecture, where it lives
   * in the capabilities.
   */
  safety?: string;
  /**
   * No longer in Cinq's lineup. Kept, under its own name, so an old link shows
   * that this advisor has retired; it answers no new questions.
   */
  retired?: boolean;
}
