/**
 * Natural voices from ElevenLabs, called only from the server so the key
 * never reaches the browser. Only the words being read go to ElevenLabs:
 * never the question, photos or earlier turns.
 */

import type { VoiceProfile } from "@/lib/companions/types";

/** Stable on long passages and works with every voice; ELEVENLABS_MODEL can change it. */
export const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
/** Most characters in one request (the model allows 10,000; the page sends far less). */
export const MAX_SPOKEN_PIECE = 2_500;
/** Most characters of the text before and after a piece, which keeps the delivery continuous. */
export const MAX_SPOKEN_CONTEXT = 600;

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export interface SpeakRequest {
  apiKey: string;
  model: string;
  voice: VoiceProfile;
  text: string;
  previousText?: string;
  nextText?: string;
  signal?: AbortSignal;
}

/** ElevenLabs takes a speed from 0.7 to 1.2. */
function speed(rate: number): number {
  return Math.min(1.2, Math.max(0.7, rate));
}

export function elevenLabsRequest({ apiKey, model, voice, text, previousText, nextText }: Omit<SpeakRequest, "signal">) {
  const url = `${ELEVENLABS_URL}/${encodeURIComponent(voice.natural.voiceId)}/stream?output_format=mp3_44100_128`;
  const body = {
    text,
    model_id: model,
    ...(previousText ? { previous_text: previousText } : {}),
    ...(nextText ? { next_text: nextText } : {}),
    voice_settings: {
      stability: voice.natural.stability,
      similarity_boost: 0.75,
      style: voice.natural.style,
      use_speaker_boost: true,
      speed: speed(voice.rate),
    },
  };
  return {
    url,
    init: {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify(body),
    },
  };
}

/** Ask ElevenLabs for the audio of one piece; the response streams MP3. */
export function speak(request: SpeakRequest): Promise<Response> {
  const { url, init } = elevenLabsRequest(request);
  return fetch(url, { ...init, signal: request.signal });
}
