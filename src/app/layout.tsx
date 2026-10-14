import type { Metadata, Viewport } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import { currentCompanion, isCompanionId } from "@/lib/companions";
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

const isHub = !isCompanionId(process.env.COMPANION);
const companion = isHub ? null : currentCompanion();

export const metadata: Metadata = isHub
  ? {
      title: "Cinq",
      description: "Five trusted advisors.",
      appleWebApp: { capable: true, title: "Cinq", statusBarStyle: "default" },
      manifest: "/manifest.json",
      openGraph: {
        title: "Cinq",
        description: "Five trusted advisors.",
        type: "website",
      },
      robots: { index: false, follow: false },
    }
  : {
      title: companion!.name,
      description: companion!.description,
      appleWebApp: { capable: true, title: companion!.name, statusBarStyle: "default" },
      openGraph: { title: companion!.name, description: companion!.description, type: "website" },
      robots: { index: false, follow: false },
    };

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5EEE4" },
    { media: "(prefers-color-scheme: dark)", color: "#F5EEE4" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} h-full`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
