import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-serif text-3xl text-ink">Nothing here.</h1>
      <Link href="/" className="text-sm text-accent underline underline-offset-4">
        Back to Gio
      </Link>
    </main>
  );
}
