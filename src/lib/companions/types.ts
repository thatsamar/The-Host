/** The words the page shows. Safe to send to the browser. */
export interface CompanionCopy {
  id: CompanionId;
  name: string;
  /** The big line on the start screen, sign-in page and link preview. */
  tagline: string;
  /** The small line under it on the start screen. */
  subtitle: string;
  placeholder: string;
  placeholderWithPhotos: string;
  status: { thinking: string; looking: string; searching: string };
}

export type CompanionId = "gio" | "tony";

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
}
