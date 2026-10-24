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
  /** Cap output length so a runaway completion cannot eat the deadline. */
  maxTokens?: number;
}

/** Groq's GPT-OSS models are reasoning models: they burn the deadline thinking. */
const isReasoningModel = (model: string): boolean =>
  /gpt-oss|deepseek-r|qwen3|qwen\/qwen3/i.test(model);

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
      model: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
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
 * Current production model per provider.
 *
 * These are configuration defaults, not decoration: a pinned model ID is a
 * countdown timer. Groq retired `llama-3.3-70b-versatile` on 16 Aug 2026 and
 * requests for it began failing with a 404 ("does not exist or you do not have
 * access to it"). Because every agent treats any LLM failure as "fall back to
 * mock", that one retirement silently turned the entire pipeline into the mock
 * path — which is why the app still returns a complete payload while no agent
 * ever runs live. Anything that pins a model should also read the response.
 */
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/**
 * What the provider says when a model ID is gone. Detected explicitly rather
 * than by status code alone: a bad key is also a 4xx and the fix is entirely
 * different, so the two must not be collapsed into one failure.
 */
const isRetiredModelMessage = (status: number, detail: string): boolean => {
  if (status !== 400 && status !== 404) return false;
  const message = detail.toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("not have access") ||
    message.includes("decommissioned") ||
    message.includes("deprecated") ||
    (message.includes("model") && message.includes("not found"))
  );
};

/** Actionable error for a retired model ID — names the fix, not just the code. */
export class LlmModelRetiredError extends Error {
  constructor(
    readonly model: string,
    readonly provider: LlmProvider,
  ) {
    super(
      `Model "${model}" is no longer available on ${provider}. Set ${provider === "groq" ? "GROQ_MODEL" : "OPENAI_MODEL"} in .env.local to a supported ID (${provider === "groq" ? DEFAULT_GROQ_MODEL : DEFAULT_OPENAI_MODEL}) and restart the dev server`,
    );
    this.name = "LlmModelRetiredError";
  }
}

/**
 * Run one chat completion with a hard deadline.
 * Throws LlmTimeoutError / LlmUnavailableError / Error — never hangs.
 */
export class LlmRateLimitError extends Error {
  constructor(
    readonly retryAfterMs: number,
    detail: string,
  ) {
    super(`LLM rate limited (429): ${detail.slice(0, 200)}`);
    this.name = "LlmRateLimitError";
  }
}

/** Groq says "Please try again in 1.234s" / "in 850ms"; honour it. */
const parseRetryAfterMs = (response: Response, detail: string): number => {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const match = detail.match(/try again in\s+([\d.]+)\s*(ms|s)/i);
  if (match) {
    const value = Number(match[1]);
    return match[2]!.toLowerCase() === "ms" ? value : value * 1000;
  }
  return 1200;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Raised when a provider's *server-side* JSON validation rejects a response.
 * Groq's reasoning models are unreliable in `response_format: json_object`
 * mode, so this triggers one retry with JSON mode off — `extractJson` already
 * tolerates prose and markdown fences, so the trade is safe.
 */
class LlmJsonModeError extends Error {
  constructor(detail: string) {
    super(`Server-side JSON validation failed: ${detail.slice(0, 200)}`);
    this.name = "LlmJsonModeError";
  }
}

const isJsonModeFailure = (status: number, detail: string): boolean =>
  status === 400 && /failed to (generate|validate) json/i.test(detail);

/**
 * Chat completion with a hard overall deadline. A 429 is retried (with the
 * provider's suggested back-off) as long as the retry still fits inside the
 * deadline — rate limits were silently pushing whole runs onto mock data.
 */
export const callLlm = async (
  options: LlmCallOptions,
  config: LlmConfig | null = resolveLlmConfig(),
): Promise<string> => {
  if (!config) throw new LlmNotConfiguredError();

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let jsonMode = options.json === true;

  // Groq rate limits are per model, so a throttled primary can hand off to
  // models with their own quota buckets instead of dropping to mock data.
  const modelChain =
    config.provider === "groq"
      ? [config.model, ...groqFallbackModels(config.model)]
      : [config.model];
  let modelIndex = 0;

  // Each model gets one turn, plus one more pass to retry with back-off.
  const maxAttempts = modelChain.length * 2;
  let attempts = 0;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 250) throw new LlmTimeoutError(timeoutMs);
    attempts += 1;
    if (attempts > maxAttempts) throw new LlmRateLimitError(0, "all models exhausted");
    const active: LlmConfig = { ...config, model: modelChain[modelIndex]! };
    try {
      return await callLlmOnce(
        jsonMode ? options : { ...options, json: false },
        active,
        remaining,
        timeoutMs,
      );
    } catch (error) {
      // A reasoning model that cannot satisfy strict JSON mode gets one retry
      // as plain text — `extractJson` finds the object in prose anyway.
      if (error instanceof LlmJsonModeError) {
        jsonMode = false;
        continue;
      }
      // A retired model ID in the chain must not kill the run: skip it.
      if (error instanceof LlmModelRetiredError && modelIndex < modelChain.length - 1) {
        modelIndex += 1;
        continue;
      }
      if (!(error instanceof LlmRateLimitError)) throw error;

      // Throttled: jump to the next model immediately. Its quota is separate,
      // so waiting out the first model's window wastes the whole deadline.
      if (modelIndex < modelChain.length - 1) {
        modelIndex += 1;
        continue;
      }
      // Last model: honour the provider's back-off if it still fits.
      const wait = Math.min(error.retryAfterMs + 150, 4000);
      if (Date.now() + wait + 900 > deadline) throw error;
      // Reset the chain so all models are retried once more after the wait.
      modelIndex = 0;
      await sleep(wait);
    }
  }
};

/** Extra Groq models with separate quotas, tried in order. */
const groqFallbackModels = (primary: string): string[] =>
  [DEFAULT_GROQ_FALLBACK_MODEL, ...DEFAULT_GROQ_FALLBACK_CHAIN].filter(
    (model) => model && model !== primary,
  );

/** Separate-quota Groq models used when the primary is rate limited. */
export const DEFAULT_GROQ_FALLBACK_MODEL = "openai/gpt-oss-20b";

export const DEFAULT_GROQ_FALLBACK_CHAIN = [
  "qwen/qwen3.8-27b",
] as const;

const callLlmOnce = async (
  options: LlmCallOptions,
  config: LlmConfig,
  budgetMs: number,
  reportedTimeoutMs: number,
): Promise<string> => {
  const timeoutMs = reportedTimeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);

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
        // A reasoning model returns its chain-of-thought in a separate field
        // and spends most of the deadline on it, so switch it off: the agents
        // only ever want the JSON object.
        ...(isReasoningModel(config.model) ? { reasoning_effort: "low" } : {}),
        ...(options.maxTokens ? { max_completion_tokens: options.maxTokens } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = await safeReadText(response);
      if (response.status === 429) {
        throw new LlmRateLimitError(parseRetryAfterMs(response, detail), detail);
      }
      if (isJsonModeFailure(response.status, detail)) {
        throw new LlmJsonModeError(detail);
      }
      if (isRetiredModelMessage(response.status, detail)) {
        throw new LlmModelRetiredError(config.model, config.provider);
      }
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
