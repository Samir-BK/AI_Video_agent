/**
 * Text renderings of a RoleEmail: plain text, a mailto: link and an RFC 5322
 * .eml draft that any mail client can open. Pure module (type-only imports),
 * usable on the server, in the browser and under `node --test`.
 */

import type { RoleEmail } from "@/types/outreach";

/** Plain-text email body (greeting, body, link, footer). */
export const emailBodyText = (email: RoleEmail): string =>
  [
    email.greeting,
    "",
    email.body.join(" "),
    "",
    `${email.callToAction} ${email.videoUrl}`,
    "",
    "—",
    ...email.footer,
  ].join("\n");

/** Subject + body, for copy/paste. */
export const emailToPlainText = (email: RoleEmail): string =>
  [`Subject: ${email.subject}`, "", emailBodyText(email)].join("\n");

/** mailto: link that opens the draft in the operator's own mail app. */
export const mailtoUrl = (email: RoleEmail): string => {
  const to = email.recipient.email ?? "";
  const query = [
    `subject=${encodeURIComponent(email.subject)}`,
    `body=${encodeURIComponent(emailBodyText(email))}`,
  ].join("&");
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?${query}`;
};

/** Gmail's web compose screen. Works in the browser when no mail app is installed. */
export const gmailComposeUrl = (email: RoleEmail): string => {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: email.recipient.email ?? "",
    su: email.subject,
    body: emailBodyText(email),
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
};

const LOCAL_ORIGIN = /https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/gi;

/** Replace localhost links with the site the operator is actually viewing. */
export const rewriteLocalOrigins = (email: RoleEmail, origin: string): RoleEmail => {
  const publicOrigin = origin.replace(/\/$/, "");
  const fix = (value: string): string => value.replace(LOCAL_ORIGIN, publicOrigin);
  return {
    ...email,
    videoUrl: fix(email.videoUrl),
    unsubscribeUrl: fix(email.unsubscribeUrl),
    callToAction: fix(email.callToAction),
    body: email.body.map(fix),
    footer: email.footer.map(fix),
  };
};

const toBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** RFC 2047 encoding for non-ASCII header values. */
export const encodeHeader = (value: string): string =>
  /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${toBase64(value)}?=`;

const formatAddress = (name: string | null, address: string): string =>
  name ? `${encodeHeader(name)} <${address}>` : address;

const wrap76 = (value: string): string => value.replace(/(.{76})/g, "$1\r\n");

export interface EmlOptions {
  fromName: string;
  fromAddress: string;
  date: Date;
}

/**
 * Build an unsent .eml draft. `X-Unsent: 1` makes Outlook open it as a draft
 * ready to send; other clients open it as a normal message. Includes
 * List-Unsubscribe headers (RFC 8058 one-click).
 */
export const buildEml = (email: RoleEmail, options: EmlOptions): string => {
  const to = email.recipient.email
    ? formatAddress(email.recipient.name, email.recipient.email)
    : "";
  const domain = options.fromAddress.split("@")[1] ?? "velho.invalid";
  const messageId = `<${email.token || Date.now().toString(36)}.${options.date.getTime()}@${domain}>`;

  const headers = [
    `From: ${formatAddress(options.fromName, options.fromAddress)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(email.subject)}`,
    `Date: ${options.date.toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    `List-Unsubscribe: <${email.unsubscribeUrl}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    "X-Unsent: 1",
  ];

  return `${headers.join("\r\n")}\r\n\r\n${wrap76(toBase64(emailBodyText(email)))}\r\n`;
};

/** Safe file name for the download, e.g. "berner-oy-cfo.eml". */
export const emlFileName = (companyName: string, email: RoleEmail): string =>
  `${companyName}-${email.role}`
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .concat(".eml");
