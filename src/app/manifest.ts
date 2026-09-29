import type { MetadataRoute } from "next";

// Lets "Add to Home Screen" open Gio full screen, like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gio",
    short_name: "Gio",
    description: "See with a designer's eye.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f4f1",
    theme_color: "#f4f4f1",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }],
  };
}
