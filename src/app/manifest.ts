import type { MetadataRoute } from "next";
import { currentCompanion } from "@/lib/companions";

// Lets "Add to Home Screen" open the app full screen, like an app.
export default function manifest(): MetadataRoute.Manifest {
  const companion = currentCompanion();
  const ground = companion.palette === "night" ? "#0f0d0b" : "#f4f4f1";
  return {
    name: companion.name,
    short_name: companion.name,
    description: companion.description,
    start_url: "/",
    display: "standalone",
    background_color: ground,
    theme_color: ground,
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
