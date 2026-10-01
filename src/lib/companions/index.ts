import { gio } from "./gio";
import { jack } from "./jack";
import { martini } from "./martini";
import { tony } from "./tony";
import type { Companion, CompanionCopy, CompanionId, CompanionMode } from "./types";

export const COMPANIONS: Record<CompanionId, Companion> = { gio, tony, martini, jack };

/**
 * Which companion this deployment is. One codebase serves them all: each Vercel
 * project sets COMPANION (gio, tony, martini or jack). Read at build time for the
 * page, icon and link preview, and at request time for answers.
 */
export function currentCompanion(value = process.env.COMPANION): Companion {
  const id = value?.trim().toLowerCase();
  return id && Object.hasOwn(COMPANIONS, id) ? COMPANIONS[id as CompanionId] : gio;
}

export function copyOf(companion: Companion): CompanionCopy {
  const { id, name, tagline, subtitle, placeholder, placeholderWithPhotos, status, notes, journal, palette, errors } = companion;
  return {
    id,
    name,
    tagline,
    subtitle,
    placeholder,
    placeholderWithPhotos,
    status,
    ...(companion.modes ? { modes: companion.modes.map(({ id, label, plain }) => ({ id, label, ...(plain ? { plain } : {}) })) } : {}),
    ...(notes ? { notes } : {}),
    ...(journal ? { journal } : {}),
    ...(palette ? { palette } : {}),
    ...(errors ? { errors } : {}),
  };
}

/** The companion's mode with this id, if it has one. */
export function modeOf(companion: Companion, id: string | undefined): CompanionMode | undefined {
  return id ? companion.modes?.find((m) => m.id === id) : undefined;
}

export type { Companion, CompanionCopy, CompanionId, CompanionMode };
