import { readFile } from "fs/promises";
import { ImageResponse } from "next/og";
import { brandFonts } from "@/lib/brand/fonts";
import { Mark } from "./icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const isHub = process.env.COMPANION === "hub";

  if (isHub) {
    const buffer = await readFile("public/icon-180-new.png");
    return new Response(buffer, {
      headers: { "Content-Type": "image/png" },
    });
  }

  return new ImageResponse(<Mark size={180} isHub={false} />, { ...size, fonts: await brandFonts() });
}
