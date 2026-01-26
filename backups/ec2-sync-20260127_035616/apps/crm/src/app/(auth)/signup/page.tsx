import Link from "next/link";
import SignupForm from "./ui/SignupForm";

export default function SignupPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="absolute inset-0">
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover opacity-90"
        >
          <source src="/hero.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/75" />
        <div className="absolute inset-0 bg-[radial-gradient(900px_600px_at_70%_10%,rgba(10,186,181,0.20),transparent_60%)]" />
      </div>

      <header className="relative z-10 border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Baselrpa CRM
          </Link>
          <Link href="/login" className="text-sm text-white/80 transition hover:text-white">
            Login
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto grid min-h-[calc(100vh-3.5rem)] max-w-6xl items-center gap-10 px-6 py-12 md:grid-cols-2">
        <div className="max-w-xl">
          <div className="text-xs font-medium tracking-[0.22em] text-white/70">
            TIFFANY EDITION
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">
            Create your workspace.
          </h1>
          <p className="mt-4 text-sm leading-6 text-white/75 md:text-base">
            Set up your account and start building a premium workflow in minutes.
          </p>
          <div className="mt-8">
            <Link href="/" className="text-xs font-medium text-white/70 transition hover:text-white">
              ← Back
            </Link>
          </div>
        </div>

        <div className="mx-auto w-full max-w-md">
          <div className="rounded-3xl border border-white/15 bg-black/35 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="text-xs font-medium text-white/70">Get started</div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Create account</h2>
            <p className="mt-2 text-sm text-white/70">
              Use your email to create an account.
            </p>

            <SignupForm />

            <div className="mt-6 text-sm text-white/70">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-white hover:underline">
                Login
              </Link>
              .
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}


