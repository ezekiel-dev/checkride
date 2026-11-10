export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col justify-center px-6 py-24">
      <h1 className="font-[family-name:var(--font-instrument-serif)] text-[clamp(2.5rem,6vw,4.5rem)] leading-none tracking-tight text-ink">
        LaunchCheck
      </h1>
      <p className="mt-4 max-w-[68ch] text-lg text-ink-muted">
        Potential launch-readiness risks for a live site or public GitHub repo — plain English,
        severity-ranked. Not a security guarantee.
      </p>
    </main>
  );
}
