import { describe, expect, it } from "vitest";
import { COMPANIONS } from "@/lib/companions";

// The people and traditions the owner respects, embedded in each brief as influences:
// their principles, never their voices, names as labels, or invented opinions.
const section = (prompt: string, start: string, end: string) => prompt.slice(prompt.indexOf(start), prompt.indexOf(end));

describe("each advisor's influences (the owner's list)", () => {
  it("Amar: Bourdain, Tucci, Balazs, Lambert, Schrager and Ritz", () => {
    const p = COMPANIONS.tony.systemPrompt;
    expect(p).toContain("Draw inspiration from the published work and expressed perspectives of Anthony Bourdain, Stanley Tucci, André Balazs, Liz Lambert, Ian Schrager and César Ritz.");
    for (const name of ["* Anthony Bourdain:", "* Stanley Tucci:", "* André Balazs:", "* Liz Lambert:", "* Ian Schrager:", "* César Ritz:"]) expect(p).toContain(name);
    expect(p).not.toMatch(/Rick Rubin|Tyler Brûlé/);
    expect(p).toMatch(/Do not imitate their distinctive speaking styles, routinely mention their names or invent what they would think about a particular place\./);
  });

  it("Gio: designers, architects, hoteliers and image-makers, for their principles", () => {
    const s = section(COMPANIONS.gio.systemPrompt, "\nINFLUENCES\n", "\nSENSE OF PLACE\n");
    for (const name of ["Gio Ponti", "Christian Liaigre", "Axel Vervoordt", "Jean Nouvel", "Kengo Kuma", "Jaime Hayon", "Hannes Peer", "Shawn Hausman", "Piero Lissoni", "André Balazs and Liz Lambert", "Adrian Zecha", "Le Corbusier", "Mies van der Rohe", "I. M. Pei", "Frank Lloyd Wright, Rudolph Schindler and Richard Neutra", "Slim Aarons"]) expect(s).toContain(name);
    expect(s).toContain("must be simple, imperfect and beautiful");
    expect(s).toContain("they are not a style to reproduce");
    expect(s).toContain("recommend a piece because of who designed it");
  });

  it("Martine: how a gentleman dresses, the principles not the labels, and for women just as much", () => {
    const s = section(COMPANIONS.martini.systemPrompt, "\nINFLUENCES\n", "\nBRANDS AND SOURCES\n");
    for (const name of ["Tom Ford", "Ralph Lauren", "Calvin Klein", "Japanese streetwear", "Kapital", "Vivienne Westwood"]) expect(s).toContain(name);
    expect(s).toContain("the principles, not the labels");
    expect(s).toContain("apply just as much to how a woman dresses");
    expect(s).toContain("Never recommend something because it carries one of these names.");
  });

  it("Alden: Aldo Sohm, The Dead Rabbit and Dante, and what belongs to the place", () => {
    const p = COMPANIONS.alden.systemPrompt;
    for (const place of ["a michelada in Todos Santos", "a Negroni at aperitivo", "a Pimm’s Cup at a polo match", "a Shiner Bock in Marfa", "rakı in Türkbükü"]) expect(p).toContain(place);
    expect(p).toContain("Japanese whisky, mezcal, beer");
  });

  it("Goldie: the Stoics, Socrates, Gandhi, Obama, Oprah, and maya, atman and karma, with no headings", () => {
    const p = COMPANIONS.goldie.systemPrompt;
    expect(p).toContain("**What informs you:** the Stoics, Socrates, Gandhi, Barack Obama and Oprah Winfrey, and the ideas of maya, atman and karma.");
    expect(p).toContain("Never quote them as slogans, lecture, or turn advice into philosophy");
    expect(p).not.toMatch(/^#+ /m);
  });

  it("never names the founder's memoir in any advisor's instructions", () => {
    for (const c of Object.values(COMPANIONS)) expect(c.systemPrompt).not.toMatch(/Million Dollar View/i);
  });
});
