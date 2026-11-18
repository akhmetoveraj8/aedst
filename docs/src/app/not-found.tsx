import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-fd-muted-foreground">The page may have been moved or renamed.</p>
      <Link className="underline" href="/">
        Back to the overview
      </Link>
    </main>
  );
}
