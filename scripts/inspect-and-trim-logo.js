// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp");

async function inspectAndTrimLogo() {
  const inputPath = "public/inner-circle-logo.png";

  // Get metadata
  const metadata = await sharp(inputPath).metadata();
  console.log("Original dimensions:", metadata.width, "x", metadata.height);
  console.log("Aspect ratio:", (metadata.width / metadata.height).toFixed(2));

  // Extract pixel data to find the bounding box of non-transparent pixels
  const image = sharp(inputPath);
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;

  // Scan for non-transparent pixels (alpha > 50 to ignore anti-aliasing artifacts)
  const pixelSize = info.channels; // 4 for RGBA

  for (let i = 0; i < data.length; i += pixelSize) {
    const alpha = data[i + 3];
    if (alpha > 50) {
      const pixelIndex = i / pixelSize;
      const y = Math.floor(pixelIndex / info.width);
      const x = pixelIndex % info.width;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;

  console.log("\nContent bounding box:");
  console.log("Position:", minX, minY);
  console.log("Size:", contentWidth, "x", contentHeight);
  console.log("Padding left:", minX, "top:", minY, "right:", info.width - maxX - 1, "bottom:", info.height - maxY - 1);

  // If there's significant padding, trim it
  const paddingThreshold = Math.min(info.width, info.height) * 0.1; // 10% threshold
  if (minX > paddingThreshold || minY > paddingThreshold) {
    console.log("\nTrimming excess padding...");

    // Add small margin for breathing room
    const margin = 20;
    const cropLeft = Math.max(0, minX - margin);
    const cropTop = Math.max(0, minY - margin);
    const cropWidth = Math.min(info.width - cropLeft, contentWidth + margin * 2);
    const cropHeight = Math.min(info.height - cropTop, contentHeight + margin * 2);

    await sharp(inputPath)
      .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
      .png()
      .toFile("public/inner-circle-logo-trimmed.png");

    console.log("Trimmed image saved as inner-circle-logo-trimmed.png");
    console.log("New dimensions:", cropWidth, "x", cropHeight);
  } else {
    console.log("\nNo significant padding detected. Keeping original image.");
  }
}

inspectAndTrimLogo().catch(console.error);
