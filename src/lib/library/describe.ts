import type { BackgroundModel } from "@/lib/ai/types";

// Visual indexing: most of the reference library is images and image-heavy
// PDFs with little extractable text. The background model writes a detailed
// description of each image; that description is what gets embedded and
// searched, and it links back to the original image.

export const VISUAL_DESCRIPTION_SYSTEM = `You write visual descriptions of interiors, architecture and design references for a private design library. A designer will search these descriptions later to find images by material, mood, era, designer or place, so be concrete and specific. Describe only what you can see; when you infer something (a designer, a period, a region), say "likely" or "possibly".`;

export function visualDescriptionPrompt(context: { source: string; page?: number | null; nearbyText?: string }): string {
  const lines = [
    `Source: ${context.source}${context.page ? `, page ${context.page}` : ""}.`,
  ];
  const nearby = context.nearbyText?.replace(/\s+/g, " ").trim();
  if (nearby) lines.push(`Text on the same page: "${nearby.slice(0, 1200)}"`);
  lines.push(
    "",
    "Describe this image in 200 to 400 words. Use these short labeled lines, skipping any that don't apply:",
    "Subject: what it is (room type, building, object, plan, swatch, magazine spread).",
    "Architecture: structure, openings, ceiling, floor, thresholds, views.",
    "Materials and finishes: woods, stone, metals, textiles, plaster, patina.",
    "Palette: the actual colors, and their warmth and contrast.",
    "Furniture and objects: pieces and their likely designers, makers or periods when the form strongly suggests them.",
    "Lighting: daylight direction and quality, lamps and fixtures, time of day, shadow.",
    "Proportion and scale: ceiling height, density, negative space, how pieces relate to the room.",
    "Atmosphere: the feeling and how the space would be used.",
    "Sense of place: region, climate, landscape, culture the image suggests.",
    "Text: any legible captions, names or prices.",
    "",
    "No preamble or closing remarks.",
  );
  return lines.join("\n");
}

export async function describeImage(
  model: BackgroundModel,
  image: { mediaType: string; data: string },
  context: { source: string; page?: number | null; nearbyText?: string },
): Promise<string> {
  const text = await model.complete({
    system: VISUAL_DESCRIPTION_SYSTEM,
    content: [
      { type: "image", mediaType: image.mediaType, data: image.data },
      { type: "text", text: visualDescriptionPrompt(context) },
    ],
    maxTokens: 1000,
  });
  if (text.trim().length < 20) throw new Error("The image description came back empty");
  return text.trim();
}
