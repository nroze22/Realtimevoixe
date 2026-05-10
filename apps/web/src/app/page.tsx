import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-400 mb-3">Realtime Voice</p>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Live AI translation for your worship service.
        </h1>
        <p className="mt-4 text-ink-300 max-w-xl">
          Plug your sound board into a laptop, and your congregation hears the sermon in their own
          language on their own phones — within seconds. No headsets to rent, no interpreters to
          schedule.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/operator/new" className="card group hover:border-accent transition">
          <div className="text-xs font-medium uppercase tracking-wider text-ink-400 mb-2">
            For the AV team
          </div>
          <div className="text-xl font-semibold mb-2">Start a service</div>
          <p className="text-sm text-ink-300">
            Pick your audio input, choose target languages, set a cost cap, and go live in under a
            minute.
          </p>
          <div className="mt-4 text-sm text-accent group-hover:underline">Set up &rarr;</div>
        </Link>

        <Link href="/listen" className="card group hover:border-accent transition">
          <div className="text-xs font-medium uppercase tracking-wider text-ink-400 mb-2">
            For listeners
          </div>
          <div className="text-xl font-semibold mb-2">Join a service</div>
          <p className="text-sm text-ink-300">
            Tap the link your usher gave you (or scan the QR), choose your language, plug in your
            earbuds.
          </p>
          <div className="mt-4 text-sm text-accent group-hover:underline">Listen now &rarr;</div>
        </Link>
      </div>

      <footer className="mt-16 text-xs text-ink-500">
        <p>
          Powered by OpenAI <code className="text-ink-300">gpt-realtime-translate</code> and LiveKit
          Cloud. The translated voice automatically adapts to the speaker&apos;s tone. Custom voice
          cloning available once your organization is approved by OpenAI Custom Voices.
        </p>
      </footer>
    </main>
  );
}
