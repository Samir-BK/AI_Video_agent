/**
 * Spoken-narration preparation: numbers, symbols and word budgets.
 *
 * Deliberately NOT server-only — `lib/mockData.ts` is imported by the client
 * dashboard, so these must run in the browser too. Pure functions, no I/O.
 *
 * Why this exists: the storyboard timeline is fixed (intro 6s, problem 18s,
 * solution 21s), but narration is written as prose. Without an enforced budget
 * a scene's voiceover outruns its slot, so the narrator is still describing the
 * problem while the video has already cut to the solution — the two beats read
 * as unrelated instead of one argument. Everything here keeps them tied together.
 */

/**
 * Measured pace of the neural narrator (edge-tts, +4% rate) against the scene
 * timeline, including the silence between per-sentence clips. Measured across
 * the sample domains; 2.5 w/s overruns in practice, 2.4 holds.
 */
export const VELHO_WORDS_PER_SEC = 2.4;

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

/** Integer (0-999) to the words a narrator would actually say. */
export const numberToWords = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return "";
  const whole = Math.round(value);
  if (whole < 20) return ONES[whole] ?? "";
  if (whole < 100) {
    const tens = TENS[Math.floor(whole / 10)] ?? "";
    const rest = whole % 10;
    return rest === 0 ? tens : `${tens}-${ONES[rest] ?? ""}`;
  }
  if (whole < 1000) {
    const hundreds = `${ONES[Math.floor(whole / 100)] ?? ""} hundred`;
    const rest = whole % 100;
    return rest === 0 ? hundreds : `${hundreds} ${numberToWords(rest)}`;
  }
  return String(whole);
};

/** Sentence split used for captions and for budget trimming. */
export const splitSpokenSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

export const countSpokenWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

/**
 * Make narration speakable: expand symbols, spell out digits, drop characters
 * a narrator would stumble on. Applied BEFORE the budget trim, because the
 * spelled-out form is what actually occupies the seconds.
 */
export const sanitizeVoiceover = (text: string): string =>
  text
    .replace(/&/g, " and ")
    .replace(/[→➔➜]/g, " to ")
    .replace(/[“”]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[—–]/g, ", ")
    // Bare numbers must survive as words, but embedded digits (B2B, H2O) are
    // left alone: there is no word boundary inside them.
    .replace(/\b\d+(?:\.\d+)?\b/g, (match) =>
      numberToWords(Number.parseFloat(match)),
    )
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.,!?;:])(?=\S)/g, "$1 ")
    .trim();

/** How many words fit in a scene of `seconds`, including clip gaps. */
export const voiceoverWordBudget = (seconds: number): number =>
  Math.max(1, Math.floor(seconds * VELHO_WORDS_PER_SEC));

/**
 * Trim a scene's voiceover to its word budget.
 *
 * Sentences are only ever dropped from the tail, never reordered. An earlier
 * trim kept the first and last sentence and deleted the middle, which produced
 * "Here is the problem. That is roughly twenty-four hours a week." — the
 * problem itself gone. Walking in order keeps the hook and the core statement
 * and lets the call to action go, because that line is also on screen as a
 * button.
 *
 * A little slack over the budget is allowed. Playback is rate-locked to the
 * scene, so a few extra words become a slightly quicker read instead of a
 * voice that is still talking after the picture has changed.
 */
export const fitVoiceoverToSeconds = (
  text: string,
  seconds: number,
): string => {
  const sentences = splitSpokenSentences(text);
  const budget = voiceoverWordBudget(seconds);
  if (sentences.length === 0) return "";
  if (sentences.length === 1) return sentences[0]!;

  const total = sentences.reduce(
    (sum, sentence) => sum + countSpokenWords(sentence),
    0,
  );
  if (total <= budget) return sentences.join(" ");

  const slack = Math.max(budget + 4, Math.ceil(budget * 1.2));
  const kept: string[] = [];
  let words = 0;

  for (const sentence of sentences) {
    const next = words + countSpokenWords(sentence);
    if (kept.length > 0 && next > slack) break;
    kept.push(sentence);
    words = next;
  }

  return kept.join(" ");
};

/** Playback rate that stretches one clip across the scene it belongs to. */
export const NARRATION_RATE_MIN = 0.72;
export const NARRATION_RATE_MAX = 1.45;

export const narrationPlaybackRate = (
  audioSec: number,
  sceneSec: number,
): number => {
  if (!(audioSec > 0) || !(sceneSec > 0)) return 1;
  const raw = audioSec / sceneSec;
  return Math.min(NARRATION_RATE_MAX, Math.max(NARRATION_RATE_MIN, raw));
};

/** One word of a synthesized clip, in seconds from the start of that clip. */
export interface SpokenWord {
  text: string;
  start: number;
  end: number;
}

/** A caption line already placed on the video clock. */
export interface TimedCue {
  startSec: number;
  endSec: number;
  text: string;
}

const normalizeToken = (token: string): string =>
  token.toLowerCase().replace(/[^a-z0-9']/g, "");

/**
 * Place each sentence on the video clock so the caption changes when that
 * sentence is actually heard.
 *
 * `rate` is the same playback rate the player uses, so a word that starts at
 * `t` seconds in the file is on screen at `t / rate` seconds into the scene.
 * When the recognizer's word list doesn't line up with the script, fall back
 * to sharing the scene in proportion to word count — still on the video clock,
 * which the rate-lock is stretching the audio to fill.
 */
export const lockedCaptionCues = (
  voiceover: string,
  sceneStart: number,
  sceneEnd: number,
  audioSec: number,
  words: SpokenWord[],
): TimedCue[] => {
  const sentences = splitSpokenSentences(voiceover);
  if (sentences.length === 0) return [];

  const span = Math.max(sceneEnd - sceneStart, 0.1);
  const rate = narrationPlaybackRate(audioSec, span);
  const grouped = groupWords(sentences, words);

  if (grouped) {
    return grouped.flatMap(({ sentence, start, end }) => {
      const startSec = sceneStart + start / rate;
      const endSec = Math.min(sceneEnd, sceneStart + Math.max(end, start + 0.08) / rate);
      if (startSec >= sceneEnd - 0.04) return [];
      return [{ text: sentence, startSec, endSec: Math.max(endSec, startSec + 0.08) }];
    });
  }

  const counts = sentences.map((sentence) => countSpokenWords(sentence) || 1);
  const totalWords = counts.reduce((sum, count) => sum + count, 0);
  let cursor = sceneStart;
  return sentences.map((sentence, index) => {
    const isLast = index === sentences.length - 1;
    const end = isLast ? sceneEnd : cursor + span * (counts[index]! / totalWords);
    const cue = { startSec: cursor, endSec: end, text: sentence };
    cursor = end;
    return cue;
  });
};

const groupWords = (
  sentences: string[],
  words: SpokenWord[],
): { sentence: string; start: number; end: number }[] | null => {
  if (words.length === 0) return null;

  let index = 0;
  const groups: { sentence: string; start: number; end: number }[] = [];

  for (const sentence of sentences) {
    const expected = sentence.split(/\s+/).map(normalizeToken).filter(Boolean).length;
    if (expected === 0 || index >= words.length) return null;

    const start = words[index]!.start;
    let consumed = 0;
    let end = start;
    while (index < words.length && consumed < expected) {
      const token = normalizeToken(words[index]!.text);
      end = words[index]!.end;
      index += 1;
      if (token) consumed += 1;
    }
    if (consumed === 0) return null;
    groups.push({ sentence, start, end });
  }

  const leftover = words.length - index;
  if (leftover > Math.max(2, Math.round(words.length * 0.25))) return null;
  return groups;
};

/**
 * The one call both the mock generator and the live agent use: make the
 * narration speakable, then guarantee it fits the scene it plays over.
 */
export const prepareVoiceover = (text: string, seconds: number): string =>
  fitVoiceoverToSeconds(sanitizeVoiceover(text), seconds);