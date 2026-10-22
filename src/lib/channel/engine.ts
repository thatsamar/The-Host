// The messaging channel's way into Cinq's engine: the same provider, model
// settings, web search, prompt assembly and answer handling as the website's
// ask route (getChatProvider + ask), for whichever advisor the person chose.
// Nothing about an advisor is defined here.

import { getChatProvider } from "@/lib/ai";
import { unavailable } from "@/lib/ai/anthropic";
import { ask } from "@/lib/ask/ask";
import { COMPANIONS } from "@/lib/companions";
import { errorClass } from "@/lib/diagnostics";
import type { Engine } from "./types";

export function cinqEngine(): Engine {
  return {
    async answer(advisor, turns, signal) {
      const companion = COMPANIONS[advisor];
      if (companion.retired) return { text: "", error: `${companion.name} is no longer one of Cinq's advisors.` };
      let provider;
      try {
        provider = getChatProvider(companion);
      } catch (err) {
        console.error("Messages: advisor misconfigured", JSON.stringify({ advisor, error: errorClass(err) }));
        return { text: "", error: unavailable(companion.name) };
      }
      let text = "";
      let error: string | undefined;
      for await (const event of ask({ provider, companion, signal }, turns)) {
        if (event.type === "text") text += event.text;
        else if (event.type === "error") error = event.message;
      }
      return { text, error };
    },
  };
}
