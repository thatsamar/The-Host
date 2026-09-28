import { redirect } from "next/navigation";
import { defaultProjectId } from "@/lib/db/workspace";

export default async function Home() {
  const projectId = await defaultProjectId();
  if (!projectId) {
    return (
      <main className="flex min-h-full items-center justify-center p-8 text-center">
        <p className="max-w-sm font-serif text-lg text-ink-soft">
          No projects yet. Run <code>npm run bootstrap</code> to create the household account and the General
          Design Brain.
        </p>
      </main>
    );
  }
  redirect(`/p/${projectId}`);
}
