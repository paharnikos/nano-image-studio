import "@fontsource-variable/manrope";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nano Studio",
  description: "A focused personal image generation workbench for nano-gpt.com.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
