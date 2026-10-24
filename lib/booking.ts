/**
 * One-click meeting link used by the video CTA and the landing page button.
 *
 * Set NEXT_PUBLIC_BOOKING_URL to a Calendly / Cal.com / HubSpot link and the
 * prospect lands straight on the calendar, prefilled with their company.
 * With no link set, it opens a prefilled email so the CTA still works on stage.
 */
export const buildBookingUrl = (companyName: string, domain: string): string => {
  const base = process.env.NEXT_PUBLIC_BOOKING_URL?.trim();
  if (base) {
    try {
      const url = new URL(base);
      url.searchParams.set("utm_source", "velho_video");
      url.searchParams.set("utm_campaign", domain);
      // Calendly / Cal.com both prefill custom answers from these.
      url.searchParams.set("a1", companyName);
      return url.toString();
    } catch {
      return base;
    }
  }

  const subject = encodeURIComponent(`15-minute walkthrough for ${companyName}`);
  const body = encodeURIComponent(
    `Hi Velho team,\n\nI watched the video for ${companyName} (${domain}). ` +
      "Let's book the 15-minute walkthrough. A few times that work for me:\n\n- \n- \n",
  );
  return `mailto:hello@velho.ai?subject=${subject}&body=${body}`;
};
