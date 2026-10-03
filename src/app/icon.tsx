import { ImageResponse } from "next/og";
import { BRAND, brandFonts } from "@/lib/brand/fonts";
import { currentCompanion } from "@/lib/companions";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default async function Icon() {
  const isHub = process.env.COMPANION === "hub";
  return new ImageResponse(<Mark size={512} isHub={isHub} />, { ...size, fonts: await brandFonts() });
}

export function Mark({ size, isHub = false }: { size: number; isHub?: boolean }) {
  if (isHub) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.ground,
          color: BRAND.ink,
        }}
      >
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 120 120" fill="none">
          <circle
            cx="60"
            cy="60"
            r="50"
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            opacity="0.8"
          />
          <circle cx="60" cy="60" r="48" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3" />
        </svg>
      </div>
    );
  }

  const companion = currentCompanion();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: companion.iconTile,
        color: BRAND.ground,
        fontFamily: "Schibsted Grotesk",
        fontWeight: 700,
        fontSize: size * 0.62,
        letterSpacing: "-0.04em",
        paddingBottom: size * 0.04,
      }}
    >
      {companion.name[0]}
    </div>
  );
}
