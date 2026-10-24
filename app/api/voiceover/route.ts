import { NextResponse } from "next/server";

import { synthesizeSpeech } from "@/lib/tts";
import type { VoiceoverRequest, VoiceoverUnavailable } from "@/types/pipeline";

/**
 * POST /api/voiceover  { text } -> audio bytes (audio/mpeg or audio/wav)
 *
 * Keeps provider keys server-side. When no neural voice is available it
 * returns 200 JSON { provider: "browser" } so the player falls back to
 * speechSynthesis instead of failing on stage.
 */

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_CHARS = 600;

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

  const { result, errors } = await synthesizeSpeech(text);
  if (!result) {
    const reason =
      errors.length > 0
        ? errors.join(" | ")
        : "No TTS key configured (ELEVENLABS_API_KEY, OPENAI_API_KEY or GROQ_API_KEY)";
    console.warn(`[voiceover] falling back to browser voice: ${reason}`);
    return unavailable(reason);
  }

  return new NextResponse(result.audio, {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Voiceover-Provider": result.provider,
    },
  });
}
