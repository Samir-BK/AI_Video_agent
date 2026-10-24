import type { Metadata } from "next";

import { getOutreachStore, tokenKey } from "@/lib/outreach/store";

/**
 * /unsubscribe?t=<token> — the link in every outreach email footer.
 * Asks for one confirmation click (a POST), so automatic link scanners in
 * mail systems cannot unsubscribe people by just opening the link.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe — Velho",
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export default function UnsubscribePage({ searchParams }: PageProps) {
  const token = typeof searchParams.t === "string" ? searchParams.t : "";
  const store = getOutreachStore();
  const record = token ? store.resolveToken(token) : null;
  const alreadyOut =
    token !== "" &&
    (store.isDoNotContact(tokenKey(token)) ||
      (record?.email ? store.isDoNotContact(record.email) : false));
  const done = searchParams.done === "1" || alreadyOut;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-5 px-4 py-12">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-velho-muted">Velho</p>
      {!record ? (
        <>
          <h1 className="text-xl font-semibold text-zinc-50">Link not recognised</h1>
          <p className="text-sm text-zinc-300">
            This unsubscribe link is not valid. If you want us to stop contacting you, just reply
            &ldquo;no thanks&rdquo; to the email and we will not contact you again.
          </p>
        </>
      ) : done ? (
        <>
          <h1 className="text-xl font-semibold text-zinc-50">You are unsubscribed</h1>
          <p className="text-sm text-zinc-300">
            We will not contact you again about this. Sorry for the interruption.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-zinc-50">Stop hearing from Velho?</h1>
          <p className="text-sm text-zinc-300">
            Confirm below and we will not contact you again.
          </p>
          <form method="post" action={`/api/outreach/unsubscribe?t=${encodeURIComponent(token)}`}>
            <input type="hidden" name="t" value={token} />
            <input type="hidden" name="source" value="page" />
            <button
              type="submit"
              className="w-full rounded-xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-white"
            >
              Unsubscribe
            </button>
          </form>
        </>
      )}
    </main>
  );
}
