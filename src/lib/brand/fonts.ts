import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Static instances of the two brand faces (SIL Open Font License, see
// assets/fonts), for images drawn at build time: the app icon and the link
// preview. The page itself loads the fonts through next/font.
export async function brandFonts() {
  const [display, bold] = await Promise.all([
    readFile(join(process.cwd(), "assets/fonts/Newsreader-Display.ttf")),
    readFile(join(process.cwd(), "assets/fonts/SchibstedGrotesk-Bold.ttf")),
  ]);
  return [
    { name: "Newsreader", data: display, weight: 400 as const, style: "normal" as const },
    { name: "Schibsted Grotesk", data: bold, weight: 700 as const, style: "normal" as const },
  ];
}

export const BRAND = { ground: "#F5EEE4", ink: "#2B2320", muted: "#75695F" };
