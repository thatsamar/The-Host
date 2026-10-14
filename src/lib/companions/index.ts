import { alden } from "./alden";
import { gio } from "./gio";
import { jack } from "./jack";
import { martini } from "./martini";
import { tony } from "./tony";
import { goldie } from "./goldie";
import type { Companion, CompanionCopy, CompanionId } from "./types";

/** Every advisor Cinq has had, retired ones included, so an old deployment still knows who it was. */
export const COMPANIONS: Record<CompanionId, Companion> = { gio, tony, martini, alden, goldie, jack };

/** Cinq's five advisors today, in the order the hub lists them. */
export const ACTIVE_LINEUP: CompanionId[] = ["tony", "martini", "gio", "alden", "goldie"];

/**
 * Which companion this deployment is. One codebase serves them all: each Vercel
 * project sets COMPANION (gio, tony, martini, alden or goldie; jack for his
 * retired address). Read at build time for the page, icon and link preview, and
 * at request time for answers.
 */
export function currentCompanion(value = process.env.COMPANION): Companion {
  const id = value?.trim().toLowerCase();
  return id && Object.hasOwn(COMPANIONS, id) ? COMPANIONS[id as CompanionId] : gio;
}

/** Whether COMPANION names a known advisor, active or retired (otherwise the deployment is the hub). */
export function isCompanionId(value: string | undefined): value is CompanionId {
  const id = value?.trim().toLowerCase();
  return !!id && Object.hasOwn(COMPANIONS, id);
}

export function copyOf(companion: Companion): CompanionCopy {
  const { id, name, tagline, subtitle, role, intro, placeholder, placeholderWithPhotos, status } = companion;
  return { id, name, tagline, subtitle, role, intro, placeholder, placeholderWithPhotos, status };
}

export type { Companion, CompanionCopy, CompanionId };
