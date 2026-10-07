import { readFile } from "fs/promises";
import { ImageResponse } from "next/og";
import { BRAND, brandFonts } from "@/lib/brand/fonts";
import { currentCompanion } from "@/lib/companions";

const isHub = process.env.COMPANION === "hub";
const companion = currentCompanion();

export const alt = isHub ? "Cinq. Five trusted advisors." : `${companion.name}. ${companion.description}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The preview shown when the link is shared in Messages, Mail or Slack.
export default async function OpengraphImage() {
  if (isHub) {
    const buffer = await readFile("public/cinq-link-preview.png");
    return new Response(buffer, { headers: { "Content-Type": "image/png" } });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: BRAND.ground,
          color: BRAND.ink,
        }}
      >
        <div style={{ fontFamily: "Schibsted Grotesk", fontWeight: 700, fontSize: 44, letterSpacing: "-0.04em" }}>{companion.name}</div>
        <div style={{ marginTop: 36, fontFamily: "Newsreader", fontSize: 104, letterSpacing: "-0.025em", lineHeight: 1 }}>
          {companion.tagline}
        </div>
      </div>
    ),
    { ...size, fonts: await brandFonts() },
  );
}
