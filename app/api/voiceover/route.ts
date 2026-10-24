import { NextResponse } from "next/server";

import { synthesizeSpeech } from "@/lib/tts";
import type {
  VoiceoverClip,
  VoiceoverRequest,
  VoiceoverUnavailable,
} from "@/types/pipeline";

/**
 * POST /api/voiceover  { text } -> JSON clip
 *
 * One request is one scene, not one sentence. The body carries the audio
 * plus word timings so the player can stretch that clip across the scene
 * and move the captions with the words actually being spoken.
 *
 * When no neural voice is available the body is
 * { provider: "browser", reason } and the player uses speechSynthesis.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_CHARS = 900;

const unavailable = (reason: string): NextResponse<VoiceoverUnavailable> =>
  NextResponse.json(
    { provider: "browser", reason },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );

export async function POST(request: Request): Promise<NextResponse> {
  let body: Partial<VoiceoverRequest>;
  try {
    body = (await request.json()) as Partial<VoiceoverRequest>;
  } catch {
    return NextResponse.json({ error: "Expected { text: string }" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `text must be ${MAX_CHARS} characters or fewer` },
      { status: 400 },
    );
  }

  const { result, errors } = await synthesizeSpeech(text, request.signal);
  if (!result) {
    const reason =
      errors.length > 0
        ? errors.join(" | ")
        : "No TTS key configured (ELEVENLABS_API_KEY, OPENAI_API_KEY or GROQ_API_KEY)";
    console.warn(`[voiceover] falling back to browser voice: ${reason}`);
    return unavailable(reason);
  }

  const clip: VoiceoverClip = {
    provider: result.provider,
    mime: result.contentType,
    audio: Buffer.from(result.audio).toString("base64"),
    words: result.words,
  };

  return NextResponse.json(clip, {
    status: 200,
    headers: { "Cache-Control": "private, max-age=3600" },
  });
}
