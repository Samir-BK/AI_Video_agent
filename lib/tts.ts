import "server-only";

import type { VoiceoverProvider } from "@/types/pipeline";

/**
 * Neural text-to-speech for the video voiceover.
 *
 * Provider chain (first configured one that succeeds wins):
 *   1. ElevenLabs — ELEVENLABS_API_KEY (most human, broadcast quality)
 *   2. OpenAI     — OPENAI_API_KEY (gpt-4o-mini-tts with delivery direction)
 *   3. Groq       — GROQ_API_KEY (Orpheus; accept the model terms once in the Groq console)
 *
 * Each call is capped at 6s (project rule). If every provider fails the route
 * tells the client to fall back to browser speechSynthesis.
 */

export const TTS_TIMEOUT_MS = 6000;

export type NeuralProvider = Exclude<VoiceoverProvider, "browser">;

export interface TtsResult {
  audio: ArrayBuffer;
  contentType: string;
  provider: NeuralProvider;
}

const VOICE_DIRECTION =
  "Premium B2B brand narrator for a product launch film. Confident, warm, polished. " +
  "Measured pace and crisp diction. Slight gravity on the problem, rising optimism on the solution, " +
  "and an inviting smile on the call to action.";

/* ---------------- cache ---------------- */

const CACHE_LIMIT = 128;
const cache = new Map<string, TtsResult>();

const remember = (key: string, value: TtsResult): void => {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
};

/* ---------------- fetch helper ---------------- */

const postWithDeadline = async (
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<ArrayBuffer> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${response.status} ${detail.slice(0, 160)}`);
    }
    return await response.arrayBuffer();
  } finally {
    clearTimeout(timer);
  }
};

/* ---------------- providers ---------------- */

type Provider = {
  id: NeuralProvider;
  enabled: () => boolean;
  synth: (text: string) => Promise<TtsResult>;
};

const env = (name: string): string => process.env[name]?.trim() ?? "";

const PROVIDERS: Provider[] = [
  {
    id: "elevenlabs",
    enabled: () => env("ELEVENLABS_API_KEY") !== "",
    synth: async (text) => {
      // Default voice "Brian": deep, trustworthy narrator.
      const voiceId = env("ELEVENLABS_VOICE_ID") || "nPczCjzI2devNBz1zQrb";
      const audio = await postWithDeadline(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
        { "xi-api-key": env("ELEVENLABS_API_KEY") },
        {
          text,
          model_id: env("ELEVENLABS_MODEL") || "eleven_turbo_v2_5",
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.8,
            style: 0.35,
            use_speaker_boost: true,
          },
        },
      );
      return { audio, contentType: "audio/mpeg", provider: "elevenlabs" };
    },
  },
  {
    id: "openai",
    enabled: () => env("OPENAI_API_KEY") !== "",
    synth: async (text) => {
      const model = env("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
      const audio = await postWithDeadline(
        "https://api.openai.com/v1/audio/speech",
        { Authorization: `Bearer ${env("OPENAI_API_KEY")}` },
        {
          model,
          voice: env("OPENAI_TTS_VOICE") || "onyx",
          input: text,
          response_format: "mp3",
          ...(model.startsWith("gpt-4o") ? { instructions: VOICE_DIRECTION } : {}),
        },
      );
      return { audio, contentType: "audio/mpeg", provider: "openai" };
    },
  },
  {
    id: "groq",
    enabled: () => env("GROQ_API_KEY") !== "",
    synth: async (text) => {
      const audio = await postWithDeadline(
        "https://api.groq.com/openai/v1/audio/speech",
        { Authorization: `Bearer ${env("GROQ_API_KEY")}` },
        {
          model: env("GROQ_TTS_MODEL") || "canopylabs/orpheus-v1-english",
          voice: env("GROQ_TTS_VOICE") || "troy",
          input: text,
          response_format: "wav",
        },
      );
      return { audio, contentType: "audio/wav", provider: "groq" };
    },
  },
];

export const isNeuralTtsConfigured = (): boolean =>
  PROVIDERS.some((provider) => provider.enabled());

/**
 * Voice one line of narration. Returns null (with collected errors) when no
 * provider could produce audio, so the caller can degrade gracefully.
 */
export const synthesizeSpeech = async (
  text: string,
): Promise<{ result: TtsResult | null; errors: string[] }> => {
  const cached = cache.get(text);
  if (cached) return { result: cached, errors: [] };

  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    if (!provider.enabled()) continue;
    try {
      const result = await provider.synth(text);
      if (result.audio.byteLength < 256) throw new Error("empty audio");
      remember(text, result);
      return { result, errors };
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? `timed out after ${TTS_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : "unknown error";
      errors.push(`${provider.id}: ${message}`);
    }
  }
  return { result: null, errors };
};
