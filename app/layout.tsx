import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Doable",
    template: "%s · Doable",
  },
  description:
    "A local-first AI software engineering workspace: discover, plan, build, inspect, and export real projects.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}