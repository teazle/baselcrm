import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-14">
        <div className="flex flex-1 flex-col justify-center">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary" />
            Baselrpa CRM • Tiffany Edition
          </div>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Luxury CRM shell is ready.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Next.js App Router + Tailwind is set up. Next we’ll wire Supabase
            auth and start building Contacts, Companies, Projects, Cases, Visits
            and Receipts.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-95"
              href="/crm"
            >
              Open CRM
            </Link>
            <Link
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-card px-5 text-sm font-medium text-foreground transition hover:bg-muted"
              href="/login"
            >
              Login
            </Link>
          </div>
        </div>

        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          Tip: run <span className="font-mono">npm install</span> in{" "}
          <span className="font-mono">apps/crm</span> then{" "}
          <span className="font-mono">npm run dev</span>.
        </footer>
      </div>
    </div>
  );
}
