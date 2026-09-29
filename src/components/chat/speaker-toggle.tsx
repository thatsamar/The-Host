"use client";

import { HUMAN_SPEAKERS, type HumanSpeaker } from "@/lib/gio/speakers";
import { cn } from "@/lib/utils";

export function SpeakerToggle({
  value,
  onChange,
  disabled,
}: {
  value: HumanSpeaker;
  onChange: (speaker: HumanSpeaker) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Who is speaking" className="inline-flex rounded-md border border-stone bg-paper-sunk p-0.5">
      {HUMAN_SPEAKERS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          disabled={disabled}
          onClick={() => onChange(s)}
          className={cn(
            "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
            value === s ? "bg-paper-raised text-ink shadow-sm" : "text-ink-muted hover:text-ink",
          )}
        >
          {s}
        </button>
      ))}
    </div>
  );
}
