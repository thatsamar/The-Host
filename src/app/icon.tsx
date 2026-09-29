import { ImageResponse } from "next/og";
import { BRAND, brandFonts } from "@/lib/brand/fonts";
import { currentCompanion } from "@/lib/companions";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default async function Icon() {
  return new ImageResponse(<Mark size={512} />, { ...size, fonts: await brandFonts() });
}

export function Mark({ size }: { size: number }) {
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
