import "server-only";

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { VoiceoverProvider, VoiceoverWord } from "@/types/pipeline";

/**
 * Neural text-to-speech for the video voiceover.
 *
 * Provider chain (first configured one that succeeds wins):
 *   1. ElevenLabs — ELEVENLABS_API_KEY (most human, broadcast quality)
 *   2. OpenAI     — OPENAI_API_KEY (gpt-4o-mini-tts with delivery direction)
 *   3. macOS say  — local, no key, ready in about a second
 *   4. Edge       — free neural, flaky under load
 *   5. Groq       — GROQ_API_KEY (Orpheus; accept the model terms in the console)
 *
 * Hosted providers are capped at 6s. Edge is capped higher: a full scene is
 * one request and the socket regularly needs 7–11s to return audio. Killing
 * it at 6s is what dropped the narrator onto the browser voice mid-video.
 * Anything slower still falls back; the request never hangs the stage.
 */

export const TTS_TIMEOUT_MS = 6000;

/** Outer bound for one Edge scene, including per-line retries. */
export const EDGE_TIMEOUT_MS = 50000;

export type NeuralProvider = Exclude<VoiceoverProvider, "browser">;

export interface TtsResult {
  audio: ArrayBuffer;
  contentType: string;
  provider: NeuralProvider;
  /** Empty when the provider doesn't return word timings. */
  words: VoiceoverWord[];
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

/* ---------------- Edge neural voice (free) ---------------- */

const edgePython = (): string =>
  env("EDGE_TTS_PYTHON") || join(process.cwd(), ".venv-tts", "bin", "python");

const edgeScript = (): string => join(process.cwd(), "scripts", "edge_speak.py");

/**
 * One Edge synthesis at a time. Parallel scenes used to open several sockets
 * at once; Microsoft answers those with `NoAudioReceived`, and the missing
 * line was then spoken by the browser in a different voice.
 */
let edgeTail: Promise<unknown> = Promise.resolve();

const enqueueEdge = <T>(job: () => Promise<T>): Promise<T> => {
  const run = edgeTail.then(job, job);
  edgeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

interface EdgePayload {
  audio: string;
  words: VoiceoverWord[];
}

const isWord = (value: unknown): value is VoiceoverWord => {
  if (!value || typeof value !== "object") return false;
  const word = value as Partial<VoiceoverWord>;
  return (
    typeof word.text === "string" &&
    typeof word.start === "number" &&
    typeof word.end === "number"
  );
};

const runEdgeScript = (text: string, signal?: AbortSignal): Promise<EdgePayload> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("client aborted"));
      return;
    }

    const child = spawn(
      edgePython(),
      [
        edgeScript(),
        env("EDGE_TTS_VOICE") || "en-US-AndrewNeural",
        env("EDGE_TTS_RATE") || "+4%",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error: Error | null, payload?: EdgePayload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (payload) resolve(payload);
    };
    const abort = () => {
      child.kill();
      finish(new Error("client aborted"));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`timed out after ${EDGE_TIMEOUT_MS}ms`));
    }, EDGE_TIMEOUT_MS);
    signal?.addEventListener("abort", abort);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) {
        finish(new Error(stderr.trim().slice(0, 240) || `edge-tts exited ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as Partial<EdgePayload>;
        if (typeof parsed.audio !== "string" || parsed.audio.length < 16) {
          finish(new Error("edge-tts returned no audio"));
          return;
        }
        const words = Array.isArray(parsed.words) ? parsed.words.filter(isWord) : [];
        finish(null, { audio: parsed.audio, words });
      } catch {
        finish(new Error("edge-tts returned malformed timings"));
      }
    });

    child.stdin.write(text);
    child.stdin.end();
  });

const synthEdge = (text: string, signal?: AbortSignal): Promise<TtsResult> =>
  enqueueEdge(async () => {
    if (signal?.aborted) throw new Error("client aborted");
    const payload = await runEdgeScript(text, signal);
    const file = Buffer.from(payload.audio, "base64");
    if (file.byteLength < 256) throw new Error("edge-tts produced empty audio");
    const audio = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer;
    return { audio, contentType: "audio/mpeg", provider: "edge", words: payload.words };
  });

/* ---------------- macOS say (local, always-on) ---------------- */

const SAY_BIN = "/usr/bin/say";

const runSayOnce = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(SAY_BIN, args, { timeout: 15000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${error.message} ${String(stderr).slice(0, 160)}`));
      else resolve();
    });
  });

const synthMacos = async (text: string): Promise<TtsResult> => {
  const dir = await mkdtemp(join(tmpdir(), "velho-say-"));
  const textFile = join(dir, "line.txt");
  const outFile = join(dir, "vo.wav");
  try {
    await writeFile(textFile, text, "utf8");
    const voice = env("MACOS_TTS_VOICE") || "Daniel";
    const rate = env("MACOS_TTS_RATE") || "185";
    try {
      await runSayOnce([
        "-v",
        voice,
        "-r",
        rate,
        "--data-format=LEI16@22050",
        "-o",
        outFile,
        "-f",
        textFile,
      ]);
    } catch {
      await runSayOnce([
        "-v",
        "Samantha",
        "-r",
        rate,
        "--data-format=LEI16@22050",
        "-o",
        outFile,
        "-f",
        textFile,
      ]);
    }
    const file = await readFile(outFile);
    if (file.byteLength < 256) throw new Error("say produced empty audio");
    const audio = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer;
    return { audio, contentType: "audio/wav", provider: "macos", words: [] };
  } finally {
    void rm(dir, { recursive: true, force: true });
  }
};

/* ---------------- providers ---------------- */

type Provider = {
  id: NeuralProvider;
  enabled: () => boolean;
  synth: (text: string, signal?: AbortSignal) => Promise<TtsResult>;
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
      return { audio, contentType: "audio/mpeg", provider: "elevenlabs", words: [] };
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
      return { audio, contentType: "audio/mpeg", provider: "openai", words: [] };
    },
  },
  {
    // Local macOS narrator. No key, no socket. This is what keeps the video
    // from going silent when Edge drops the line and Groq wants terms accepted.
    id: "macos",
    enabled: () => env("MACOS_TTS") !== "off" && existsSync(SAY_BIN),
    synth: synthMacos,
  },
  {
    // Free Microsoft neural voices (same as Edge "Read aloud"). No key needed;
    // runs scripts/edge_speak.py with the venv from `npm run setup:voice`.
    id: "edge",
    enabled: () =>
      env("EDGE_TTS") !== "off" &&
      existsSync(edgePython()) &&
      existsSync(edgeScript()),
    synth: synthEdge,
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
      return { audio, contentType: "audio/wav", provider: "groq", words: [] };
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
  signal?: AbortSignal,
): Promise<{ result: TtsResult | null; errors: string[] }> => {
  const cached = cache.get(text);
  if (cached) return { result: cached, errors: [] };

  const errors: string[] = [];
  for (const provider of PROVIDERS) {
    if (signal?.aborted) {
      errors.push("aborted");
      break;
    }
    if (!provider.enabled()) continue;
    try {
      const result = await provider.synth(text, signal);
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
      if (message === "client aborted") break;
    }
  }
  return { result: null, errors };
};
