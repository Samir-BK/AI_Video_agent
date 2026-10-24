import "server-only";

/**
 * Minimal LLM client that speaks the OpenAI-compatible chat completions
 * protocol. Works with OpenAI directly or Groq by swapping base URL + key.
 *
 * Design rule for stage safety: every call is hard-capped by an AbortController
 * deadline. Callers catch failures and fall back to mock data.
 */

export type LlmProvider = "openai" | "groq";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCallOptions {
  messages: LlmMessage[];
  /** Hard deadline in ms. Defaults to 6000 per project rules. */
  timeoutMs?: number;
  temperature?: number;
  /** Ask the API for a JSON object response where supported. */
  json?: boolean;
}

export const DEFAULT_TIMEOUT_MS = 6000;

export class LlmTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM call exceeded ${timeoutMs}ms deadline`);
    this.name = "LlmTimeoutError";
  }
}

export class LlmUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "LlmUnavailableError";
  }
}

/**
 * No provider credentials at all. This is deliberately distinct from a failed
 * call: it is a setup problem with an exact fix, so the pipeline log points the
 * operator at the file they need to edit instead of a vague "LLM failed".
 */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      "No LLM key configured — add GROQ_API_KEY or OPENAI_API_KEY to .env.local and restart the dev server",
    );
    this.name = "LlmNotConfiguredError";
  }
}

/** Resolve provider config from env, preferring Groq then OpenAI. */
export const resolveLlmConfig = (): LlmConfig | null => {
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    return {
      provider: "groq",
      apiKey: groqKey,
      model: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
      baseUrl: "https://api.groq.com/openai/v1",
    };
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    return {
      provider: "openai",
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    };
  }

  return null;
};

export const isLlmConfigured = (): boolean => resolveLlmConfig() !== null;

/**
 * Run one chat completion with a hard deadline.
 * Throws LlmTimeoutError / LlmUnavailableError / Error — never hangs.
 */
export const callLlm = async (
  options: LlmCallOptions,
  config: LlmConfig | null = resolveLlmConfig(),
): Promise<string> => {
  if (!config) {
    throw new LlmNotConfiguredError();
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        ...(options.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new Error(
        `LLM request failed (${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("LLM returned an empty completion");
    }
    return content;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LlmTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const safeReadText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
};

/* ------------------------------------------------------------------ */
/* JSON extraction                                                     */
/* ------------------------------------------------------------------ */

/**
 * Models occasionally wrap JSON in prose or fences. Extract the first
 * balanced JSON object and parse it. Returns null instead of throwing.
 */
export const extractJson = <T,>(raw: string): T | null => {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const candidates: string[] = [cleaned];

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next candidate
    }
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* Deadline helper                                                     */
/* ------------------------------------------------------------------ */

/**
 * Race an async task against a deadline.
 *
 * If the task wins, its value is returned. If the deadline fires first, the
 * task is abandoned (its result is ignored) and `onTimeout` is invoked exactly
 * once to produce a fallback value. `onTimeout` is never called twice, and
 * rejections are surfaced as `timedOut: false` so callers can decide.
 */
export const withDeadline = async <T,>(
  task: () => Promise<T>,
  timeoutMs: number,
  onTimeout: () => T | Promise<T>,
): Promise<{ value: T; timedOut: boolean }> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      task().then((value) => ({ value, timedOut: false as const })),
      new Promise<{ value: T; timedOut: true }>((resolve) => {
        timer = setTimeout(() => {
          void Promise.resolve()
            .then(onTimeout)
            .then((value) => resolve({ value, timedOut: true }))
            .catch(() => resolve({ value: undefined as unknown as T, timedOut: true }));
        }, timeoutMs);
      }),
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
};
