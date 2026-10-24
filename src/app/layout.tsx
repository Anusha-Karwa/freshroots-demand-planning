import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freshroots Demand Planning",
  description: "Twice-weekly demand plan: rules flag, Gemini explains, Raghav decides, Zoho drafts the PO.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
