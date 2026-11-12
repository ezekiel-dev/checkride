import { ScanForm } from "@/components/scan-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col px-6">
      <section className="flex flex-1 flex-col justify-center py-20 sm:py-28">
        <p className="font-mono text-xs tracking-[0.2em] text-ink-muted uppercase">
          Pre-flight / Launch readiness
        </p>
        <h1 className="mt-4 max-w-[16ch] font-display text-[clamp(2.75rem,7vw,5.25rem)] leading-[1.04] tracking-tight text-ink">
          Is your AI-built app{" "}
          <span className="box-decoration-clone bg-highlight px-1 text-ink">ready</span> to launch?
        </h1>
        <p className="mt-6 max-w-[62ch] text-lg text-ink-muted">
          Paste a live site URL and/or a public GitHub repo. Get a plain-English, severity-ranked
          list of potential launch-readiness issues — like a checklist before takeoff.
        </p>

        <div className="mt-10 w-full max-w-[720px]">
          <ScanForm />
        </div>

        <p className="mt-6 font-mono text-xs text-ink-muted">
          Passive checks only. We never touch your data.
        </p>
      </section>
    </main>
  );
}
