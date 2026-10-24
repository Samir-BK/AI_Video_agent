"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowRight, Globe, Loader2, Sparkles } from "lucide-react";

import { SAMPLE_DOMAINS } from "@/lib/mockData";

interface DomainInputProps {
  onSubmit: (domain: string) => void;
  isLoading: boolean;
  /** Validation or pipeline error surfaced by the parent. */
  error?: string | null;
}

/** Loose client-side check; the API is the real gate. */
const looksLikeDomain = (value: string): boolean =>
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0] ?? "",
  );

export default function DomainInput({
  onSubmit,
  isLoading,
  error,
}: DomainInputProps) {
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmed = value.trim();
  const isInvalid = touched && trimmed.length > 0 && !looksLikeDomain(trimmed);

  const submit = useCallback(
    (candidate: string) => {
      const next = candidate.trim();
      if (!next || isLoading || !looksLikeDomain(next)) return;
      onSubmit(next);
    },
    [isLoading, onSubmit],
  );

  return (
    <div className="w-full">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          submit(value);
        }}
        className="group relative"
      >
        {/* Ambient glow behind the bar. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-4 -inset-y-8 rounded-[32px] bg-[radial-gradient(60%_100%_at_50%_50%,rgba(56,189,248,0.10),transparent_70%)] opacity-0 transition-opacity duration-500 group-focus-within:opacity-100"
        />

        <div
          className={`relative flex items-center gap-2 rounded-2xl border bg-velho-panel/80 p-2 backdrop-blur transition-colors duration-200 ${
            isInvalid
              ? "border-rose-500/50"
              : "border-velho-line focus-within:border-sky-500/60"
          }`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04]">
            <Globe className="h-[18px] w-[18px] text-zinc-500" strokeWidth={1.75} />
          </div>

          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => setTouched(true)}
            disabled={isLoading}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            placeholder="Enter a company domain — e.g. fazer.com"
            aria-label="Target company domain"
            aria-invalid={isInvalid}
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[15px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={isLoading || trimmed.length === 0}
            className="group/btn flex h-10 shrink-0 items-center gap-2 rounded-xl bg-zinc-100 px-4 text-[13px] font-semibold text-zinc-900 transition-all duration-200 hover:bg-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-zinc-500"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
                <span className="hidden sm:inline">Running</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" strokeWidth={2.25} />
                <span className="hidden sm:inline">Generate</span>
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-0.5 sm:hidden"
                  strokeWidth={2.25}
                />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Validation + pipeline errors */}
      <AnimatePresence mode="wait">
        {(isInvalid || error) && (
          <motion.div
            key={isInvalid ? "invalid" : "error"}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="mt-2.5 flex items-start gap-2 px-1 text-[13px] text-rose-400"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            <span>
              {isInvalid
                ? "That doesn't look like a domain. Try the bare hostname, like fazer.com."
                : error}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* One-click sample domains */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-600">
          Try
        </span>
        {SAMPLE_DOMAINS.map((sample) => (
          <button
            key={sample}
            type="button"
            disabled={isLoading}
            onClick={() => {
              setValue(sample);
              setTouched(true);
              submit(sample);
            }}
            className="rounded-full border border-velho-line bg-white/[0.02] px-3 py-1 font-mono text-[11px] text-zinc-400 transition-colors duration-150 hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sample}
          </button>
        ))}
      </div>
    </div>
  );
}
