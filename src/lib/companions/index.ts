import { gio } from "./gio";
import { martini } from "./martini";
import { tony } from "./tony";
import type { Companion, CompanionCopy, CompanionId } from "./types";

export const COMPANIONS: Record<CompanionId, Companion> = { gio, tony, martini };

/**
 * Which companion this deployment is. One codebase serves both: each Vercel
 * project sets COMPANION (gio, tony or martini). Read at build time for the page, icon
 * and link preview, and at request time for answers.
 */
export function currentCompanion(value = process.env.COMPANION): Companion {
  const id = value?.trim().toLowerCase();
  return id && Object.hasOwn(COMPANIONS, id) ? COMPANIONS[id as CompanionId] : gio;
}

export function copyOf(companion: Companion): CompanionCopy {
  const { id, name, tagline, subtitle, placeholder, placeholderWithPhotos, status } = companion;
  return { id, name, tagline, subtitle, placeholder, placeholderWithPhotos, status };
}

export type { Companion, CompanionCopy, CompanionId };
