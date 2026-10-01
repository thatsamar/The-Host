import { ImageResponse } from "next/og";
import { BRAND, brandFonts } from "@/lib/brand/fonts";
import { currentCompanion } from "@/lib/companions";

const companion = currentCompanion();

export const alt = `${companion.name}. ${companion.description}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The preview shown when the link is shared in Messages, Mail or Slack.
export default async function OpengraphImage() {
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
          background: companion.palette === "night" ? "#0f0d0b" : BRAND.ground,
          color: companion.palette === "night" ? "#ece4d6" : BRAND.ink,
        }}
      >
        <div style={{ fontFamily: "Schibsted Grotesk", fontWeight: 700, fontSize: 44, letterSpacing: "-0.04em" }}>{companion.name}</div>
        <div
          style={{
            marginTop: 36,
            maxWidth: 1040,
            textAlign: "center",
            fontFamily: "Newsreader",
            fontSize: 104,
            letterSpacing: "-0.025em",
            lineHeight: 1,
          }}
        >
          {companion.tagline}
        </div>
      </div>
    ),
    { ...size, fonts: await brandFonts() },
  );
}
