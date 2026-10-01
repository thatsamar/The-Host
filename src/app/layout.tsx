import type { Metadata, Viewport } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import { currentCompanion } from "@/lib/companions";
import "./globals.css";

// next/font downloads these at build time and serves them from this app, so
// the browser never contacts Google.
const serif = Newsreader({
  variable: "--font-serif-face",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

const sans = Schibsted_Grotesk({
  variable: "--font-sans-face",
  subsets: ["latin"],
});

const companion = currentCompanion();

export const metadata: Metadata = {
  title: companion.name,
  description: companion.description,
  appleWebApp: {
    capable: true,
    title: companion.name,
    statusBarStyle: companion.palette === "night" ? "black-translucent" : "default",
  },
  openGraph: { title: companion.name, description: companion.description, type: "website" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor:
    companion.palette === "night"
      ? "#0f0d0b"
      : [
          { media: "(prefers-color-scheme: light)", color: "#f4f4f1" },
          { media: "(prefers-color-scheme: dark)", color: "#121213" },
        ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-palette={companion.palette}
      className={`${serif.variable} ${sans.variable} h-full`}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
