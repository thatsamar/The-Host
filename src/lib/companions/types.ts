/** A way of asking, picked on the page. Its instruction joins the prompt. */
export interface CompanionMode {
  id: string;
  label: string;
  instruction: string;
  /** A careful moment: errors read plainly, without the companion's swagger. */
  plain?: boolean;
}

/** Error lines in the companion's own voice, for moments that aren't careful ones. */
export interface CompanionErrors {
  /** Can't be reached, misconfigured, or anything unexpected. */
  unavailable: string;
  /** Overloaded or rate limited. */
  busy: string;
}

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
  /** Modes to pick from; the first is the default. None: no picker. */
  modes?: Pick<CompanionMode, "id" | "label" | "plain">[];
  /** Answers end with a notes block (src/lib/ask/notes.ts) shown as cards. */
  notes?: boolean;
  /** Saved lines, patterns and drafts, kept in the visitor's browser. */
  journal?: boolean;
  /** "night": dark whatever the device setting. */
  palette?: "night";
  errors?: CompanionErrors;
}

export type CompanionId = "gio" | "tony" | "martini" | "jack";

/** One character on the shared engine: what it's told, and how it looks. */
export interface Companion extends Omit<CompanionCopy, "modes"> {
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
  modes?: CompanionMode[];
}
