import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF parsing and page rendering use Node-specific packages (a native canvas
  // binding and PDF.js's worker), so load them with plain Node require.
  serverExternalPackages: ["unpdf", "pdfjs-dist", "@napi-rs/canvas", "mammoth"],
  // Make sure the files those packages load at runtime ship with the
  // serverless functions that index the library.
  outputFileTracingIncludes: {
    "/api/library/process": [
      "./node_modules/pdfjs-dist/legacy/build/**/*",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
      "./node_modules/@napi-rs/canvas*/**/*",
    ],
  },
};

export default nextConfig;
