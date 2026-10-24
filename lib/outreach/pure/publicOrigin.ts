/**
 * Origin used inside outreach emails (video page and unsubscribe).
 * A localhost NEXT_PUBLIC_APP_URL must not win on the public site.
 */

const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(?::\d+)?$/i;

const isLocalUrl = (value: string): boolean => {
  try {
    return LOCAL_HOST.test(new URL(value).host);
  } catch {
    return true;
  }
};

const clean = (value: string | null | undefined): string => value?.trim().replace(/\/$/, "") ?? "";

const hostUrl = (host: string | null | undefined, proto: string | null | undefined): string => {
  const name = clean(host).split(",")[0]?.trim() ?? "";
  if (!name || LOCAL_HOST.test(name)) return "";
  const scheme = clean(proto).split(",")[0]?.trim() || "https";
  return `${scheme}://${name}`;
};

export interface PublicOriginInput {
  configured?: string | null;
  requestOrigin?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  vercelProductionHost?: string | null;
  vercelHost?: string | null;
}

/** First public origin, otherwise the local one used in development. */
export const publicAppOrigin = (input: PublicOriginInput): string => {
  const configured = clean(input.configured);
  if (configured && !isLocalUrl(configured)) return configured;

  const forwarded = hostUrl(input.forwardedHost, input.forwardedProto);
  if (forwarded) return forwarded;

  const requestOrigin = clean(input.requestOrigin);
  if (requestOrigin && !isLocalUrl(requestOrigin)) return requestOrigin;

  const production = clean(input.vercelProductionHost);
  if (production) return `https://${production}`;

  const vercel = clean(input.vercelHost);
  if (vercel) return `https://${vercel}`;

  return configured || requestOrigin || "http://localhost:3000";
};
