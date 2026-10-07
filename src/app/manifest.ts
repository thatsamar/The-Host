import type { MetadataRoute } from "next";
import { currentCompanion } from "@/lib/companions";

// Lets "Add to Home Screen" open the app full screen, like an app.
export default function manifest(): MetadataRoute.Manifest {
  const isHub = process.env.COMPANION === "hub";

  if (isHub) {
    return {
      name: "Cinq",
      short_name: "Cinq",
      description: "A collective of trusted advisors.",
      start_url: "/",
      display: "standalone",
      background_color: "#FAF9F6",
      theme_color: "#FAF9F6",
      icons: [
        { src: "/icon-192-new.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512-new.png", sizes: "512x512", type: "image/png" },
      ],
    };
  }

  const companion = currentCompanion();
  return {
    name: companion.name,
    short_name: companion.name,
    description: companion.description,
    start_url: "/",
    display: "standalone",
    background_color: "#f4f4f1",
    theme_color: "#f4f4f1",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
