/**
 * Playing an answer aloud in the page: the advisor's natural voice from
 * /api/speak when the deployment has one, otherwise (or if it fails partway)
 * the device's own voice. Only one reading plays at a time across the page.
 */

import type { VoiceProfile } from "@/lib/companions/types";
import { chooseVoice, spokenChunks } from "@/lib/speech";

export interface Reading {
  stop(): void;
}

let active: Reading | null = null;

/** Stop whatever is reading now, anywhere on the page. */
export function stopReading(): void {
  const current = active;
  active = null;
  current?.stop();
}

/** Make this the one reading on the page; stopping it also runs `onStop`. */
export function setReading(reading: Reading, onStop: () => void): void {
  stopReading();
  let stopped = false;
  active = {
    stop() {
      if (stopped) return;
      stopped = true;
      reading.stop();
      onStop();
    },
  };
}

/** Clear this reading if it is still the active one (it ended by itself). */
export function readingEnded(): void {
  active = null;
}

export const canSpeakOnDevice = (): boolean =>
  typeof window !== "undefined" && "speechSynthesis" in window && !!window.speechSynthesis && "SpeechSynthesisUtterance" in window;

type AudioContextClass = typeof AudioContext;
function audioContextClass(): AudioContextClass | undefined {
  if (typeof window === "undefined") return undefined;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
}

export const canPlayAudio = (): boolean => !!audioContextClass();

/** Read text with the device's own voice, chosen to suit the advisor. */
export function speakWithDevice(text: string, voice: VoiceProfile, onEnd: () => void): Reading {
  const synth = window.speechSynthesis;
  const deviceVoice = chooseVoice(synth.getVoices(), voice);
  synth.cancel();
  const chunks = spokenChunks(text);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(watch);
    onEnd();
  };
  chunks.forEach((chunk, i) => {
    const utterance = new SpeechSynthesisUtterance(chunk);
    if (deviceVoice) utterance.voice = deviceVoice;
    utterance.lang = deviceVoice?.lang ?? voice.lang;
    utterance.rate = voice.rate;
    utterance.pitch = voice.pitch;
    utterance.onerror = finish;
    if (i === chunks.length - 1) utterance.onend = finish;
    synth.speak(utterance);
  });
  // Some browsers end speech without an event; notice when it has gone quiet.
  const watch = setInterval(() => {
    if (!synth.speaking && !synth.pending) finish();
  }, 500);
  if (!chunks.length) finish();
  return {
    stop() {
      done = true;
      clearInterval(watch);
      synth.cancel();
    },
  };
}

/**
 * Play pieces of audio in order through Web Audio. The context is created
 * inside the tap, which is what lets a phone play sound. `load` fetches a
 * piece (and is asked for the next one early, so there's no gap); if a piece
 * fails, `fallback` gets where to carry on from.
 */
export function playPieces(options: {
  count: number;
  load: (index: number) => Promise<ArrayBuffer>;
  onEnd: () => void;
  fallback: (from: number, err: unknown) => void;
}): Reading {
  const { count, load, onEnd, fallback } = options;
  const Context = audioContextClass()!;
  const ctx = new Context();
  void ctx.resume().catch(() => {});
  let stopped = false;
  let source: AudioBufferSourceNode | null = null;

  const close = () => {
    try {
      source?.stop();
    } catch {}
    void ctx.close().catch(() => {});
  };

  void (async () => {
    for (let i = 0; i < count; i++) {
      let buffer: AudioBuffer;
      try {
        const bytes = await load(i);
        if (i + 1 < count) load(i + 1).catch(() => {});
        if (stopped) return;
        // decodeAudioData takes the bytes over, so give it a copy and keep the cached original.
        buffer = await ctx.decodeAudioData(bytes.slice(0));
      } catch (err) {
        if (stopped) return;
        stopped = true;
        close();
        fallback(i, err);
        return;
      }
      if (stopped) return;
      await new Promise<void>((resolve) => {
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(ctx.destination);
        node.onended = () => resolve();
        source = node;
        node.start();
      });
      if (stopped) return;
    }
    stopped = true;
    close();
    onEnd();
  })();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      close();
    },
  };
}

/** Why the natural voice didn't play: its HTTP status, if the server answered. */
export class SpeakError extends Error {
  constructor(readonly status: number) {
    super(`speak_${status}`);
  }
}
