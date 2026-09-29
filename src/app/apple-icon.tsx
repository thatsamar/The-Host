import { ImageResponse } from "next/og";
import { brandFonts } from "@/lib/brand/fonts";
import { Mark } from "./icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS rounds the corners and shows "Gio" under it on the home screen.
export default async function AppleIcon() {
  return new ImageResponse(<Mark size={180} />, { ...size, fonts: await brandFonts() });
}
