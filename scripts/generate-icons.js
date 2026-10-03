// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require("sharp");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const warmIvory = "#f5f1ed";
const sizes = [180, 192, 512];
const padding = 20;
const inputPath = "public/inner-circle-logo.png";
const outputDir = "public";

async function generateIcons() {
  for (const size of sizes) {
    const canvasSize = size;
    const contentSize = size - padding * 2;

    // Create SVG with warm-ivory background and centered image
    const svg = `
      <svg width="${canvasSize}" height="${canvasSize}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${canvasSize}" height="${canvasSize}" fill="${warmIvory}"/>
        <image x="${padding}" y="${padding}" width="${contentSize}" height="${contentSize}" href="data:image/png;base64,${await fs.promises.readFile(inputPath, "base64")}" preserveAspectRatio="xMidYMid meet"/>
      </svg>
    `;

    // Convert SVG to PNG
    await sharp(Buffer.from(svg))
      .png()
      .toFile(path.join(outputDir, `icon-${size}-new.png`));

    console.log(`✓ Generated icon-${size}-new.png`);
  }
}

generateIcons().catch(console.error);
