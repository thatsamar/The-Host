import { describe, expect, it } from "vitest";
import type { ChatContentPart } from "@/lib/ai/types";
import { APP_JUDGMENT, APP_OUTPUT_LIMITS, BLOCK_ORDER, assemblePrompt, capabilitiesBlock, toChatTurns } from "@/lib/ask/prompt";
import { COMPANIONS } from "@/lib/companions";
import { alden } from "@/lib/companions/alden";
import { gio } from "@/lib/companions/gio";
import { jack } from "@/lib/companions/jack";
import { martini } from "@/lib/companions/martini";
import { tony } from "@/lib/companions/tony";
import { goldie } from "@/lib/companions/goldie";

const textOf = (parts: ChatContentPart[]) =>
  parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
const img = (data = "aW1n") => ({ mediaType: "image/jpeg", data });

describe("assemblePrompt", () => {
  it.each(Object.values(COMPANIONS))("puts $name's prompt first, verbatim, then its capabilities", (companion) => {
    const req = assemblePrompt({ companion, turns: [{ role: "user", text: "Hi" }] });
    expect(req.system.map((b) => b.label)).toEqual([...BLOCK_ORDER]);
    expect(req.system[0].body).toBe(companion.systemPrompt);
    expect(req.system[1].body).toBe([...companion.capabilities(true), APP_JUDGMENT, APP_OUTPUT_LIMITS].join("\n"));
    expect(req.system.every((b) => b.cacheable)).toBe(true);
    expect(req.webSearch).toBe(true);
  });
});

describe("what a reply can be", () => {
  it.each(Object.values(COMPANIONS))("tells $name it can't make or send files, with or without web search", (companion) => {
    for (const webSearch of [true, false]) {
      const body = capabilitiesBlock(companion, webSearch).body;
      expect(body.split("\n").at(-1)).toBe(APP_OUTPUT_LIMITS);
    }
  });

  it("forbids claiming a file was made, and says what to do when one is asked for", () => {
    expect(APP_OUTPUT_LIMITS).toMatch(/cannot create, attach, export, upload or send files/);
    expect(APP_OUTPUT_LIMITS).toMatch(/PNG, PDF/);
    expect(APP_OUTPUT_LIMITS).toMatch(/never say or imply that you have/);
    expect(APP_OUTPUT_LIMITS).toMatch(/If someone asks for a file, say plainly that this app can't produce one, then give them the content you can/);
  });

  it("keeps the substance: the full plan in the reply, with layouts labeled as text", () => {
    expect(APP_OUTPUT_LIMITS).toMatch(/Put the substance in the reply itself, in full/);
    expect(APP_OUTPUT_LIMITS).toMatch(/plans, measurements, quantities, schedules, lists and tables/);
    expect(APP_OUTPUT_LIMITS).toMatch(/labeled as a text layout rather than a drawing or map/);
    // Nothing that would cut an answer short.
    expect(APP_OUTPUT_LIMITS).not.toMatch(/\b(brief|short|concise|shorter|limit your)\b/i);
  });

  it("is the same for every companion and names none of them", () => {
    for (const c of Object.values(COMPANIONS)) expect(APP_OUTPUT_LIMITS).not.toContain(c.name);
  });
});

describe("The call: Cinq's shared standard of judgment", () => {
  it.each(Object.values(COMPANIONS))("is given to $name, just before the output limits, with or without web search", (companion) => {
    for (const webSearch of [true, false]) {
      const lines = capabilitiesBlock(companion, webSearch).body.split("\n");
      expect(lines.at(-2)).toBe(APP_JUDGMENT);
      expect(lines.at(-1)).toBe(APP_OUTPUT_LIMITS);
    }
  });

  it("asks for earned judgment, not borrowed experience", () => {
    expect(APP_JUDGMENT).toMatch(/^Your judgment should feel earned: by close attention to this person's situation, real knowledge of the field, and an understanding of how a choice plays out in life\./);
    expect(APP_JUDGMENT).toMatch(/Notice something consequential, explain why it matters, and make a call\./);
    expect(APP_JUDGMENT).toMatch(/You have no personal history: never claim to have been somewhere, tasted, worn, met or seen something yourself\./);
    expect(APP_JUDGMENT).toMatch(/Never use a cultural reference as decoration to simulate experience/);
  });

  it.each(["tony", "martini", "gio", "alden", "goldie"] as const)("gives %s an independent view: honest agreement or disagreement, never flattery or invented dissent", (id) => {
    const body = capabilitiesBlock(COMPANIONS[id], true).body;
    expect(body).toContain(APP_JUDGMENT);
    // Independent judgment, before the person's framing.
    expect(APP_JUDGMENT).toMatch(/Form your own view of the person's actual goal before accepting their framing or preferred answer\./);
    expect(APP_JUDGMENT).toMatch(/Do not flatter them, automatically validate a choice, or agree merely because they seem to want agreement\./);
    // Specific reasons either way.
    expect(APP_JUDGMENT).toMatch(/say so plainly, name the detail that changes your mind, and offer the better path\./);
    expect(APP_JUDGMENT).toMatch(/When you agree, show the specific reason you agree\./);
    // Not contrarianism.
    expect(APP_JUDGMENT).toMatch(/Do not invent a disagreement, dismiss what the person knows about their own life, or mistake a forceful tone for sound judgment\./);
    // It comes right after the view-early sentence.
    expect(APP_JUDGMENT.indexOf("Form your own view")).toBeGreaterThan(APP_JUDGMENT.indexOf("Give a considered view early"));
  });

  it("lets Goldie challenge an interpretation and give advice without taking the big decisions", () => {
    const body = capabilitiesBlock(goldie, true).body;
    expect(body).toMatch(/If you think their plan, purchase or interpretation misses the mark, say so plainly/);
    expect(body).toMatch(/You give advice: name the problem plainly, show who is absorbing the cost and what needs to give, and recommend one practical next step/);
    expect(body).toMatch(/You do not make major life or relationship decisions on the person's behalf; those stay theirs/);
    expect(body).not.toMatch(/You do not tell the user what to do\./);
    expect(body).toMatch(/dismiss what the person knows about their own life/);
  });

  it("asks for a view early with its observation, one coherent path, and only the research that helps", () => {
    expect(APP_JUDGMENT).toMatch(/Give a considered view early, before any heading, and show the observation that led to it/);
    expect(APP_JUDGMENT).toMatch(/choose one coherent path\. Offer another only when a real difference in preference, circumstance or budget changes the answer/);
    expect(APP_JUDGMENT).toMatch(/Include prices, sources, caveats and technical details when they help the decision or prevent a mistake\. Leave the rest of the research out\./);
  });

  it("makes The call an optional closing action, never an opening label or a recap, with nothing after it", () => {
    expect(APP_JUDGMENT).toMatch(/you may end with a short section headed The call \(a Markdown heading, ### The call/);
    expect(APP_JUDGMENT).toMatch(/what you recommend, reject, would do next, would wait for, or need to know before deciding/);
    expect(APP_JUDGMENT).toMatch(/does not repeat the opening or summarize the answer/);
    expect(APP_JUDGMENT).toMatch(/The call is only ever the ending: never use it to label your opening view, and nothing follows it\./);
    expect(APP_JUDGMENT).toMatch(/Wherever your instructions mention The call, they mean this optional ending\./);
  });

  it("calibrates confidence to the evidence and the stakes, and never fakes precision", () => {
    expect(APP_JUDGMENT).toMatch(/Match the strength of your recommendation to the quality of the evidence and the consequences of being wrong/);
    expect(APP_JUDGMENT).toMatch(/Do not invent precision, imply that you saw details you could not see, or present a guess as certainty/);
    expect(APP_JUDGMENT).toMatch(/Separate what you can see or have verified from what you infer\./);
    expect(APP_JUDGMENT).toMatch(/When an expensive or hard-to-reverse recommendation rests on an uncertain premise[\s\S]*say how to check it first\./);
  });

  it("claims only what the photo and the person's words establish, without hedging a sound call", () => {
    expect(APP_JUDGMENT).toMatch(/Be as exact about what the photo and the person's words establish as about the recommendation/);
    expect(APP_JUDGMENT).toMatch(/a photo of an object does not show the weather or the temperature of the room, and the name of a place does not establish its conditions/);
    expect(APP_JUDGMENT).toMatch(/give the one condition that decides it[\s\S]*rather than asserting it\./);
    expect(APP_JUDGMENT).toMatch(/Do not pile generic caveats onto a well-supported call\./);
  });

  it("is optional: never forced into brief replies, follow-ups or delicate moments", () => {
    expect(APP_JUDGMENT).toMatch(/when it would help the person act/);
    expect(APP_JUDGMENT).toMatch(/Do not force The call into a brief reply, a conversational follow-up, or an emotionally delicate moment/);
    expect(APP_JUDGMENT).toMatch(/Never add it merely to satisfy a format/);
    expect(APP_JUDGMENT).toMatch(/the person makes the decision/);
    expect(APP_JUDGMENT).toMatch(/not a shared voice or an answer template/);
  });

  it("is the same for every companion, names none of them, and uses no em dashes (Amar never does)", () => {
    for (const c of Object.values(COMPANIONS)) expect(APP_JUDGMENT).not.toContain(c.name);
    expect(APP_JUDGMENT).not.toContain("—");
  });

  it.each(Object.values(COMPANIONS))("gives $name nothing that would put The call at the start", (companion) => {
    for (const webSearch of [true, false]) {
      const text = [
        ...assemblePrompt({ companion, turns: [{ role: "user", text: "Hi" }], webSearch }).system.map((b) => b.body),
        companion.photosOnly(1),
        companion.photosOnly(3),
      ].join("\n");
      // No opening label, and no instruction to open, start or lead with a call.
      expect(text).not.toMatch(/THE VERDICT|NEXT STEP — /);
      expect(text).not.toMatch(/\b(open|start|lead|begin)\w*( \w+){0,3} with (a |the )?([\w,-]+ ){0,2}call\b/i);
      // A photo with no question asks for a read, not for "the call".
      expect(companion.photosOnly(1)).not.toMatch(/\bcall\b/i);
    }
  });

  it("leaves no stacked section template, and mentions The call only as an optional ending", () => {
    for (const prompt of [gio.systemPrompt, martini.systemPrompt, alden.systemPrompt]) {
      expect(prompt).not.toMatch(/^(WHY|THE MOVE|WHAT NOT TO DO|COST|REFERENCE|THE CALL|NEXT STEP) — /m);
      expect(prompt).not.toMatch(/^(Why|The move|Alternative|The call): /m);
      expect(prompt).toMatch(/If a closing action helps, end with it as (The call|THE CALL)[.,][\s\S]{0,60}[Nn]othing comes after it\./);
    }
    expect(gio.systemPrompt).toMatch(/Lead with your strongest judgment, in your own words, and the observation in the room that led to it\./);
    expect(gio.systemPrompt).toMatch(/Do not build a section for every heading\./);
    expect(martini.systemPrompt).toMatch(/Start with your view, in your own words: what you see, what is working, and what it says about the person\./);
    expect(martini.systemPrompt).toMatch(/Do not build a section for every point/);
    expect(capabilitiesBlock(martini, true).body).toMatch(/give your read first, in your own words[\s\S]*THE CALL only as a closing action/);
  });

  it("never gives two endings where a brief already has a closing thought (Amar)", () => {
    expect(tony.systemPrompt).toMatch(/End with the emotional key to the trip/);
    expect(APP_JUDGMENT).toMatch(/If your instructions already give you a closing thought or next step, The call takes its place or carries it; never end twice\./);
    expect(capabilitiesBlock(tony, true).body).toMatch(/End once\. The emotional key to the trip is your ending: if you label it The call, that section carries the thought in a sentence or two, and nothing comes after it\./);
  });

  it("lets Goldie close with a next step without directing someone's life", () => {
    const body = capabilitiesBlock(goldie, true).body;
    expect(body).toMatch(/you match your confidence to what you know and to the stakes/);
    expect(body).toMatch(/When you end with The call, make it the one practical move you recommend, within the person's control, or the question they need to answer next/);
    expect(body).toMatch(/Never make it a verdict on their life or relationships, or a decision that is theirs to make\./);
    expect(body).toMatch(/In grief, crisis, or a delicate moment, leave the label off\./);
    // Her brief asks for no headings, so a named call is a bold lead-in, not a heading.
    expect(goldie.systemPrompt).toMatch(/No headings\./);
    expect(body).toMatch(/begin your final short paragraph with \*\*The call:\*\* in bold rather than a heading/);
  });

  it("keeps Goldie sharp about other people without presenting a read as a fact", () => {
    expect(capabilitiesBlock(goldie, true).body).toMatch(/When you read another person's motives or feelings from it, make the observation sharp, and make clear it is your read of what you have been told, not a fact you know\./);
  });
});

describe("Gio", () => {
  it("isn't addressed to any one household", () => {
    const req = assemblePrompt({ companion: gio, turns: [{ role: "user", text: "Hi" }] });
    for (const block of req.system) expect(block.body).not.toMatch(/Courtney|Amar\b|speaker|memories are provided|uploaded library/i);
    expect(gio.systemPrompt).toMatch(/Always imagine the room at midnight/);
    expect(gio.systemPrompt).toMatch(/Could this be in almost anyone's expensive house\?/);
  });

  it("knows the app keeps nothing, doesn't assume who is asking, and prices from real listings", () => {
    const body = capabilitiesBlock(gio, true).body;
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/Don't assume their name, their taste or a home you haven't seen/);
    expect(body).toMatch(/up to 10 photos/);
    expect(body).toMatch(/web_search/);
    expect(body).toMatch(/Invest \/ save \/ skip/);
    expect(body).toMatch(/"Don't buy anything"/);
    expect(capabilitiesBlock(gio, false).body).toMatch(/Mark every price as an estimate/);
  });

  it("checks what a photo can't show before specifying a purchase, and brings in cost only when buying", () => {
    const body = capabilitiesBlock(gio, true).body;
    expect(body).toMatch(/A photograph does not establish distances, ceiling heights, compass orientation, how a room looks at night, or whether a piece of a given size will fit\./);
    expect(body).toMatch(/say that you are inferring it and how to check it[\s\S]*before you specify a purchase/);
    expect(body).toMatch(/Keep what you can see, what you infer and what needs testing distinct: do not estimate distances from perspective or describe the room at night as if you had seen it/);
    expect(body).toMatch(/When the person is deciding what to buy, give for each piece:/);
    expect(gio.systemPrompt).toMatch(/Often that judgment is to keep what works and test something before buying anything\./);
    expect(gio.systemPrompt).toMatch(/Bring in cost \(invest, save, or skip\) only when the person is actually deciding what to buy/);
    expect(gio.systemPrompt).toMatch(/If a strong preliminary view is possible, give it first\./);
  });
});

describe("Amar", () => {
  it("carries the travel point of view, with the owner's wording kept", () => {
    expect(tony.systemPrompt).toMatch(/^You are Amar Lalvani’s private travel intelligence/);
    expect(tony.systemPrompt).toMatch(/Travel is attention\./);
    expect(tony.systemPrompt).toMatch(/Never invent access, relationships, secret doors, bookings, or insider knowledge\./);
    expect(tony.systemPrompt).toMatch(/No em dashes\.\n\nBe irreverent, even profane\./);
    expect(tony.systemPrompt).not.toMatch(/em--|Boardain|a rooms/);
    expect(tony.systemPrompt).not.toContain("—");
  });

  it("checks places before sending anyone, and doesn't treat the traveler as Amar", () => {
    const body = capabilitiesBlock(tony, true).body;
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/don't call them Amar/);
    expect(body).toMatch(/web_search tool\. Use it to check that a place still exists/);
    expect(body).toMatch(/Never use em dashes/);
    expect(body).not.toContain("—");
    expect(capabilitiesBlock(tony, false).body).toMatch(/from memory and worth checking/);
  });

  it("gives one feasible route, checks what decides it, and keeps an alternative brief", () => {
    const body = capabilitiesBlock(tony, true).body;
    expect(body).toMatch(/For one night or one day, give one route someone could actually follow, in order, with its timing\./);
    expect(body).toMatch(/A materially different alternative gets a sentence or two, never a second itinerary\./);
    expect(body).toMatch(/timing, distance between stops, opening hours or reservations decide whether the plan works, check them/);
    expect(body).toMatch(/Fit the stops to the hours with the travel between them included, say how to get from one to the next, and cut a stop rather than rush the night\./);
  });

  it("reads a place from photos alone", () => {
    const [turn] = toChatTurns([{ role: "user", text: "", images: [img(), img()] }], tony.photosOnly);
    expect(textOf(turn.content)).toMatch(/^\(2 photos, no question\. Read the place/);
  });
});

describe("Martini", () => {
  it("carries the style brief as written", () => {
    expect(martini.systemPrompt).toMatch(/^You are Martine, my personal style advisor\./);
    expect(martini.systemPrompt).not.toMatch(/\bMartini\b/);
    expect(martini.systemPrompt).toMatch(/Do not treat men’s style as an afterthought or women’s style as the default\./);
    expect(martini.systemPrompt).toMatch(/INVEST:\n[\s\S]*SAVE:\n[\s\S]*SKIP:\n/);
    expect(martini.systemPrompt).toMatch(/Could this be on anyone with money\?\n\nIf yes, look harder\./);
    expect(martini.systemPrompt).toMatch(/never generic\.$/);
  });

  it("serves anyone, keeps headings for real decisions, and prices from listings", () => {
    const body = capabilitiesBlock(martini, true).body;
    expect(body).toMatch(/Never assume their gender, body, age, size, budget or taste/);
    expect(body).toMatch(/give men's, women's and mixed wardrobes equal depth/);
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/For a simple question, just answer it, without headings/);
    expect(body).toMatch(/including vintage and resale/);
    expect(capabilitiesBlock(martini, false).body).toMatch(/Mark every price as an estimate/);
  });

  it("finds the one change that makes an outfit work, without a shopping assignment or invented wear counts", () => {
    const body = capabilitiesBlock(martini, true).body;
    expect(martini.systemPrompt).toMatch(/Then name the one change that makes the outfit work where it is going/);
    expect(martini.systemPrompt).toMatch(/do not turn an outfit check into a shopping assignment: most outfits are fixed with what the person already has\./);
    expect(martini.systemPrompt).toMatch(/how often it is likely to be worn, only from what the person has told you/);
    expect(body).toMatch(/Once you have made the decisive change, stop: add a styling detail only if it changes the result\./);
    expect(body).toMatch(/Suggest buying something only when what the person has cannot solve the problem\./);
    expect(body).toMatch(/Never state how often something will be worn unless the person told you\./);
  });

  it("gives an outfit check from photos alone", () => {
    const [turn] = toChatTurns([{ role: "user", text: "", images: [img()] }], martini.photosOnly);
    expect(textOf(turn.content)).toBe("(A photo, no question. Give the outfit check: your read of it, and the one change that makes it work.)");
  });
});

describe("Jack", () => {
  it("carries the owner's core prompt, renamed, with the response pattern, focus, safety and both examples", () => {
    expect(jack.systemPrompt).toMatch(/^You are Jack: a worldly, irreverent, emotionally intelligent advisor/);
    expect(jack.systemPrompt).not.toMatch(/Most Interesting Man/);
    expect(jack.systemPrompt).toMatch(/1\. A direct opening[\s\S]*5\. A memorable closing line\./);
    expect(jack.systemPrompt).toMatch(/Do not romanticize chaos\. Do not shame longing\./);
    expect(jack.systemPrompt).toMatch(/the difference between love and obedience/);
    expect(jack.systemPrompt).toMatch(/call or text 988/);
    expect(jack.systemPrompt).toMatch(/You don't want them to need you\./);
    expect(jack.systemPrompt).toContain("Stop negotiating with a life you already know is too small.");
    expect(jack.systemPrompt).toContain("Do not hand matches to the part of you that misses the fire.");
  });

  it("knows the app keeps nothing and doesn't assume who is asking", () => {
    const body = capabilitiesBlock(jack, true).body;
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/Never assume their gender, age/);
    expect(jack.webSearchMaxUses).toBe(0);
  });
});

describe("Alden", () => {
  it("carries the owner's brief as written, as an original advisor", () => {
    expect(alden.systemPrompt).toMatch(/^You are Alden, Cinq’s advisor on wine, cocktails, and spirits\. Your knowledge also runs deep in sake and beer\./);
    expect(alden.systemPrompt).toContain("Your governing question is: What is worth drinking, for this person, at this price, in this moment?");
    for (const heading of ["START WITH THE PERSON AND THE OCCASION", "KNOW FAR MORE THAN YOU SAY", "EXERCISE JUDGMENT", "READ THE EVIDENCE", "VOICE AND RESPONSE"]) {
      expect(alden.systemPrompt).toContain(`\n${heading}\n`);
    }
    expect(alden.systemPrompt).toMatch(/Open with what you would order, open, buy, or make, in the first person, and why it beats the nearest rival for this person, meal, moment, and price\./);
    expect(alden.systemPrompt).toMatch(/Do not claim to know a bottle’s condition from a photo of a list\./);
    expect(alden.systemPrompt).toMatch(/Never encourage excessive drinking, drinking and driving, or drinking by someone under the legal drinking age\./);
    expect(alden.systemPrompt).toMatch(/Do not give personalized medical assurances about alcohol, medication, pregnancy, or recovery\.$/);
    // No real person's name or endorsement.
    for (const block of assemblePrompt({ companion: alden, turns: [{ role: "user", text: "Hi" }] }).system) {
      expect(block.body).not.toMatch(/Aldo|Sohm/);
    }
  });

  it("leads with a personal choice, defends it against the nearest rival, and keeps research behind it", () => {
    expect(alden.systemPrompt).toMatch(/Lead with a definite, personal choice: “I would order…”, “I would open…”, “I would make it this way\.”/);
    expect(alden.systemPrompt).toMatch(/why that choice beats the nearest plausible alternative for this person, at this price, in this moment/);
    expect(alden.systemPrompt).toMatch(/Usually give one choice and no alternatives\. Offer a second only when a real difference in preference or budget changes the answer/);
    expect(alden.systemPrompt).toMatch(/do not reopen every possibility/);
    expect(alden.systemPrompt).toMatch(/Show depth through discrimination, not length\./);
    expect(alden.systemPrompt).toMatch(/name the spirit you would use, the modifier, the proportions, and the technique/);
    expect(alden.systemPrompt).toMatch(/name the meal you would actually serve with it, not six pairings/);
    expect(alden.systemPrompt).toMatch(/which bottle earns the money and why it beats the obvious rival/);
    expect(alden.systemPrompt).toMatch(/Keep the research behind the recommendation\. Barcode matches, producer histories, technical production details, and global average prices belong in the answer only if they change the choice or prevent a mistake\./);
    expect(alden.systemPrompt).toMatch(/never imply that a label, a region, or an online listing proves how a particular bottle tastes or how it has been stored/);
    // Breadth, safeguards and safety stay.
    for (const area of ["Wine:", "Sake:", "Beer:", "Spirits:", "Cocktails:"]) expect(alden.systemPrompt).toContain(`\n${area} `);
    expect(alden.systemPrompt).toMatch(/Never invent a producer, vintage, price, ingredient, availability, or bottle identity\./);
    expect(alden.systemPrompt).toMatch(/Attribute sourced prices and mark unsourced prices as estimates\./);
    expect(alden.systemPrompt).toMatch(/Alcohol is optional\./);
  });

  it("reads lists, bottles and bars, keeps nothing, and searches up to five times with sourced prices", () => {
    const body = capabilitiesBlock(alden, true).body;
    expect(body).toMatch(/up to 10 photos/);
    for (const thing of ["wine list", "sake list", "cocktail menu", "beer list", "bottle", "label", "back bar", "store shelf", "meal or table"]) {
      expect(body).toContain(thing);
    }
    expect(body).toMatch(/keeps nothing/);
    expect(body).toMatch(/Don't assume the person's name, budget, company or drinking habits/);
    expect(body).toMatch(/web_search tool, up to five searches per answer/);
    expect(body).toMatch(/Briefly say what you verified/);
    expect(body).toMatch(/Give the source for any sourced price, and mark any price you did not find in a listing as an estimate/);
    expect(body.split("\n").at(-1)).toBe(APP_OUTPUT_LIMITS);
    expect(capabilitiesBlock(alden, false).body).toMatch(/Mark every price as an estimate/);
    expect(alden.webSearchMaxUses).toBe(5);
  });

  it("ends once, with any serving detail inside the answer, and lets a finished recommendation stand", () => {
    expect(alden.systemPrompt).toMatch(/If one ordering or serving detail matters, give it where it belongs in the answer rather than as a separate conclusion\./);
    expect(alden.systemPrompt).toMatch(/end with it as The call, without repeating what you have already said; nothing comes after it\./);
    expect(alden.systemPrompt).toMatch(/Once the recommendation is complete, let it stand\. Do not weaken it with a price aside or an invitation to send the menu/);
    expect(alden.systemPrompt).toMatch(/You have no personal history\./);
  });

  it("chooses from a photo alone", () => {
    const [turn] = toChatTurns([{ role: "user", text: "", images: [img()] }], alden.photosOnly);
    expect(textOf(turn.content)).toMatch(/^\(A photo, no question\. Read what's there, whether a list, a menu, a bottle or a shelf, and say what you would order or buy, and why\.\)$/);
  });
});

describe("Amar and Alden", () => {
  it("each knows the other's territory: where to go is Amar's, what to drink is Alden's", () => {
    const toAlden = capabilitiesBlock(alden, true).body;
    const toAmar = capabilitiesBlock(tony, true).body;
    expect(toAlden).toMatch(/Your territory is what to drink/);
    expect(toAlden).toMatch(/is Amar's territory in Cinq/);
    expect(toAmar).toMatch(/Your territory is where to go/);
    expect(toAmar).toMatch(/is Alden's territory in Cinq/);
    expect(toAmar).not.toContain("—");
  });
});

describe("Goldie", () => {
  it("is named Goldie at the start of her brief", () => {
    expect(goldie.systemPrompt).toMatch(/^You are Goldie: /);
    expect(goldie.systemPrompt).not.toMatch(/^You are Untangled/);
  });

  it("is a perceptive close friend who untangles the situation and says what she would do", () => {
    const brief = goldie.systemPrompt;
    expect(brief).toMatch(/^You are Goldie: the perceptive close friend people call when a situation has them stuck\./);
    expect(brief).toMatch(/untangle what is actually happening so they can move forward, and then to tell them what you would do next/);
    expect(brief).toMatch(/Name the problem plainly\. Show who is absorbing the cost and what needs to give\. Then offer the one practical move you would recommend, in direct natural language/);
    expect(brief).toMatch(/End with the one move you would make\./);
  });

  it("keeps her thinking tools behind the scenes, used only when one reveals something specific", () => {
    const brief = goldie.systemPrompt;
    // The discipline stays: facts vs fears, desires, control, ghosts, the real decision, labor vs fruits.
    expect(brief).toMatch(/What is actually happening\?/);
    expect(brief).toMatch(/What is feared versus what is actual\?/);
    expect(brief).toMatch(/What does the user want\?/);
    expect(brief).toMatch(/What can they control, influence, or neither\?/);
    expect(brief).toMatch(/Are they chasing a ghost\?/);
    expect(brief).toMatch(/What is the real decision\?/);
    expect(brief).toMatch(/You own the labor\. You do not own the fruits of the labor\./);
    // But it is not a route every answer marches along.
    expect(brief).toMatch(/They are tools, not a route your answer has to march along\./);
    expect(brief).toMatch(/Bring one into the answer only when it reveals something specific about this situation; otherwise it stays behind the scenes\./);
    expect(brief).toMatch(/Do not run every answer through facts versus fears, competing desires, control, ghosts and the real decision\./);
    expect(brief).toMatch(/Do not narrate your method or walk through your tools in order\./);
    expect(brief).toMatch(/There is no fixed closing format\./);
    // No stacked output template: the old step-by-step output list is gone.
    expect(brief).not.toMatch(/Name any ghosts you see\./);
    expect(brief).not.toMatch(/Surface the real decision\. What is actually being decided here\?/);
  });

  it("believes the person's account of what a situation is costing them", () => {
    const brief = goldie.systemPrompt;
    expect(brief).toMatch(/When someone tells you a situation is costing them, believe them\./);
    expect(brief).toMatch(/Their firsthand account of their own strain, exhaustion or unhappiness is a fact about the situation, not an assumption to test\./);
    expect(brief).toMatch(/What you may question is an assumption they have made about someone else's motives or reactions, or a prediction about what will happen\./);
    expect(brief).toMatch(/Never turn a person's account of their own life into a hypothetical flaw in their thinking\./);
    expect(capabilitiesBlock(goldie, true).body).toMatch(/The person's own account of what a situation is costing them is a fact, not an assumption to test\./);
  });

  it("gives advice instead of retreating into journaling, questions or 'only you can decide'", () => {
    const brief = goldie.systemPrompt;
    expect(brief).toMatch(/When there is enough information to give useful advice, give it\./);
    expect(brief).toMatch(/Do not retreat into a writing exercise, a list of questions to consider, or "only you can decide\."/);
    expect(brief).toMatch(/No therapy language/);
    expect(brief).not.toMatch(/Do not tell them what to do\./);
  });

  it("reconciles advice with the boundary: a next step, never a major life decision made for them", () => {
    const brief = goldie.systemPrompt;
    expect(brief).toMatch(/You give advice and a next step\. You do not make major life or relationship decisions on their behalf/);
    expect(brief).toMatch(/Match your confidence to what you know and to the stakes/);
    const body = capabilitiesBlock(goldie, true).body;
    expect(body).toMatch(/You do not make major life or relationship decisions on the person's behalf/);
    expect(body).toMatch(/You are not therapy or coaching\. You are a perceptive close friend for consequential situations\./);
    expect(body).not.toMatch(/advice column/);
    expect(goldie.webSearchMaxUses).toBe(0);
  });

  it("does not hard-code one prescription or make family the priority in every case", () => {
    const brief = goldie.systemPrompt;
    expect(brief).toMatch(/The move depends on the situation; do not reach for the same prescription every time, and do not assume which side of a tension deserves to win/);
    expect(brief).toMatch(/An example of the register, not a template\./);
    expect(brief).not.toMatch(/two evenings/i);
    expect(brief).not.toMatch(/family (comes|should come) first/i);
    expect(brief).not.toMatch(/put (your )?family first/i);
    expect(brief).not.toMatch(/Take .* for your family/);
  });
});

describe("toChatTurns", () => {
  it("sends photos before the question", () => {
    const [turn] = toChatTurns([{ role: "user", text: "What's off here?", images: [img("a"), img("b")] }], gio.photosOnly);
    expect(turn.content.map((p) => p.type)).toEqual(["image", "image", "text"]);
    expect(textOf(turn.content)).toBe("What's off here?");
  });

  it("asks for an assessment when photos arrive without a question", () => {
    const [one] = toChatTurns([{ role: "user", text: "  ", images: [img()] }], gio.photosOnly);
    expect(textOf(one.content)).toBe("(A photo, no question. Assess what you see.)");
    const [three] = toChatTurns([{ role: "user", text: "", images: [img(), img(), img()] }], gio.photosOnly);
    expect(textOf(three.content)).toBe("(3 photos, no question. Assess what you see.)");
  });

  it("replays the visit in order, skipping empty turns and merging neighbours", () => {
    const turns = toChatTurns(
      [
        { role: "assistant", text: "orphan" },
        { role: "user", text: "First" },
        { role: "assistant", text: "" },
        { role: "user", text: "Second" },
        { role: "assistant", text: "Answer" },
        { role: "user", text: "Third" },
      ],
      gio.photosOnly,
    );
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(turns[0].content)).toBe("First\nSecond");
  });

  it("keeps only the most recent turns", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `t${i}` }) as const);
    const turns = toChatTurns(many, gio.photosOnly, 10);
    expect(textOf(turns[0].content)).toBe("t40");
  });
});
