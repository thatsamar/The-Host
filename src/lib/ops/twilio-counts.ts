/**
 * Twilio's own count of texts to and from the Cinq number, per UTC day: an
 * independent record to check the measurement against, so a lost record
 * shows up as a gap instead of looking like a quiet day. Only counts leave
 * this module; Twilio's message bodies and numbers are read past, never kept.
 */

export interface DayCount {
  inbound: number;
  outbound: number;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const MAX_PAGES = 20;

async function countDay(
  opts: { accountSid: string; authToken: string; fetch: Fetch },
  filter: "To" | "From",
  number: string,
  day: string,
): Promise<number> {
  const auth = "Basic " + Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString("base64");
  let url: string | null =
    `https://api.twilio.com/2010-04-01/Accounts/${opts.accountSid}/Messages.json?` +
    new URLSearchParams({ [filter]: number, DateSent: day, PageSize: "1000" }).toString();
  let count = 0;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const res = await opts.fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`twilio_list_${res.status}`);
    const body = (await res.json()) as { messages?: { direction?: string }[]; next_page_uri?: string | null };
    for (const m of body.messages ?? []) {
      const inbound = (m.direction ?? "").startsWith("inbound");
      if (filter === "To" ? inbound : !inbound) count += 1;
    }
    url = body.next_page_uri ? `https://api.twilio.com${body.next_page_uri}` : null;
  }
  return count;
}

/** Twilio's counts for each day, or null when Twilio can't be reached or isn't configured. */
export async function twilioDailyCounts(opts: {
  accountSid: string;
  authToken: string;
  number: string;
  days: string[];
  fetch?: Fetch;
}): Promise<Record<string, DayCount> | null> {
  if (!opts.accountSid || !opts.authToken || !opts.number || !opts.days.length) return null;
  const f = opts.fetch ?? ((url, init) => fetch(url, init));
  try {
    const entries = await Promise.all(
      opts.days.map(async (day) => {
        const [inbound, outbound] = await Promise.all([
          countDay({ ...opts, fetch: f }, "To", opts.number, day),
          countDay({ ...opts, fetch: f }, "From", opts.number, day),
        ]);
        return [day, { inbound, outbound }] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

/** The last `n` complete UTC days before `now`, newest first ("2026-11-25", …). */
export function completeDays(now: number, n: number): string[] {
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(today - (i + 1) * 86_400_000).toISOString().slice(0, 10));
}
