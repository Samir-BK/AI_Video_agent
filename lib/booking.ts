/**
 * Velho Ops intro calendar. Every booking control opens this page unless
 * NEXT_PUBLIC_BOOKING_URL overrides it.
 */
const DEFAULT_BOOKING_URL = "https://ops.velho.io/book/patrik/intro";

/**
 * One-click meeting link used by the video CTA and the landing page button.
 * The prospect lands on the Velho Ops calendar. Company and domain ride along
 * as query params so the visit can be tied back to the video.
 */
export const buildBookingUrl = (companyName: string, domain: string): string => {
  const base = process.env.NEXT_PUBLIC_BOOKING_URL?.trim() || DEFAULT_BOOKING_URL;
  try {
    const url = new URL(base);
    url.searchParams.set("utm_source", "velho_video");
    url.searchParams.set("utm_campaign", domain);
    url.searchParams.set("a1", companyName);
    return url.toString();
  } catch {
    return base;
  }
};
