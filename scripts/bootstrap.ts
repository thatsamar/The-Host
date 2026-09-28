/**
 * Seeds the household: one Supabase Auth account, the "General Design Brain"
 * project (created by the on_auth_user_created trigger), and Gio's system
 * prompt in settings. Safe to re-run; it never overwrites an edited prompt.
 *
 *   npm run bootstrap -- --email you@example.com --password '…'
 *
 * Or set GIO_ACCOUNT_EMAIL / GIO_ACCOUNT_PASSWORD in .env.local.
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.
 */
import { parseArgs } from "node:util";
import { createAdminClient } from "../src/lib/supabase/admin";
import { DEFAULT_SYSTEM_PROMPT } from "../src/lib/gio/default-system-prompt";

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, password: { type: "string" } },
  });
  const email = values.email ?? process.env.GIO_ACCOUNT_EMAIL;
  const password = values.password ?? process.env.GIO_ACCOUNT_PASSWORD;
  if (!email || !password) {
    throw new Error("Provide --email and --password (or GIO_ACCOUNT_EMAIL / GIO_ACCOUNT_PASSWORD).");
  }
  if (password.length < 12) throw new Error("Use a password of at least 12 characters.");

  const admin = createAdminClient();

  // 1. The household account.
  let userId: string | undefined;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.data.user) {
    userId = created.data.user.id;
    console.log(`Created account ${email}`);
  } else {
    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    const existing = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) throw created.error ?? new Error("Could not create or find the account");
    userId = existing.id;
    console.log(`Account ${email} already exists; leaving its password unchanged.`);
  }

  const others = (await admin.auth.admin.listUsers({ perPage: 1000 })).data?.users.filter((u) => u.id !== userId);
  if (others?.length) {
    console.warn(`Warning: ${others.length} other account(s) exist. Gio is designed for a single household account.`);
  }

  // 2. Profile row and default project (the trigger normally does this).
  await must(admin.from("users").upsert({ id: userId, email }, { onConflict: "id", ignoreDuplicates: true }));
  const { data: defaults } = await admin.from("projects").select("id").eq("user_id", userId).eq("is_default", true);
  if (!defaults?.length) {
    await must(
      admin.from("projects").insert({
        user_id: userId,
        name: "General Design Brain",
        brief:
          "Household-wide design thinking that applies across every home and project: taste, principles, references and lessons learned.",
        is_default: true,
      }),
    );
    console.log("Created the General Design Brain project");
  } else {
    console.log("General Design Brain project present");
  }

  // 3. Gio's system prompt, verbatim, unless one is already stored.
  const { data: existingPrompt } = await admin
    .from("settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "system_prompt")
    .maybeSingle();
  if (existingPrompt) {
    console.log("System prompt already stored; not overwriting it.");
  } else {
    await must(admin.from("settings").insert({ user_id: userId, key: "system_prompt", value: DEFAULT_SYSTEM_PROMPT }));
    console.log("Stored Gio's default system prompt");
  }

  console.log("\nDone. Sign in at /login with that email and password.");
}

async function must(query: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await query;
  if (error) throw new Error(error.message);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
