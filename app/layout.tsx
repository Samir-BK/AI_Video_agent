import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Velho Outreach Engine — AI B2B Video Outreach",
  description:
    "Enter a domain. Five agents research the company, find the bottleneck, and produce a personalized 20-second video plus a CEO cold email.",
};

export const viewport: Viewport = {
  themeColor: "#08090d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-velho-void font-sans text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  );
}
