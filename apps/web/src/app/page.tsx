import Link from 'next/link';
import { ArrowRight, Headphones, Radio, Sparkles, Languages, Mic2, ShieldCheck } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-dvh">
      <div className="mx-auto max-w-5xl px-6 pt-14 md:pt-24 pb-20">
        {/* Hero */}
        <div className="animate-fade-in">
          <span className="chip mb-6">
            <Sparkles className="h-3 w-3 text-accent-300" /> OpenAI Realtime · LiveKit
          </span>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tightish text-balance leading-[1.05]">
            Your sermon, instantly,
            <br className="hidden sm:block" /> in every language.
          </h1>
          <p className="mt-5 text-lg text-ink-300 max-w-2xl text-pretty leading-relaxed">
            Plug your soundboard into a laptop and your congregation hears the
            message in their own language on their own phones — within seconds.
            No headsets to rent, no interpreters to schedule.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/operator/new" className="btn btn-primary btn-lg group">
              <Mic2 className="h-5 w-5" />
              Start a service
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link href="/listen" className="btn btn-ghost btn-lg">
              <Headphones className="h-5 w-5" />
              I&apos;m a listener
            </Link>
          </div>
        </div>

        {/* Entry cards */}
        <div className="mt-16 grid gap-4 md:grid-cols-2">
          <EntryCard
            href="/operator/new"
            icon={Mic2}
            kicker="For the AV team"
            title="Start a service"
            body="Pick your audio input, choose target languages, set a cost cap, and go live in under a minute."
            cta="Set up the service"
          />
          <EntryCard
            href="/listen"
            icon={Headphones}
            kicker="For listeners"
            title="Join a service"
            body="Scan the QR code your usher gave you, or enter the service code. Plug in earbuds. Pick a language. That's it."
            cta="Open the listener app"
          />
        </div>

        {/* Highlights */}
        <div className="mt-20 grid gap-5 md:grid-cols-3">
          <Highlight
            icon={Languages}
            title="13+ languages"
            body="One source, many languages in parallel. The translated voice adapts to the speaker's tone automatically."
          />
          <Highlight
            icon={Radio}
            title="Phones or headsets"
            body="Listeners use their own phones over Wi-Fi, or you can pipe the audio into your existing FM / IR / Wi-Fi receivers."
          />
          <Highlight
            icon={ShieldCheck}
            title="Cost caps built in"
            body="A hard cap per service auto-stops translation before your bill runs away. Default $30."
          />
        </div>

        {/* Footer note */}
        <footer className="mt-20 text-xs text-ink-500">
          <p>
            Powered by{' '}
            <code className="font-mono text-ink-300">gpt-realtime-translate</code>{' '}
            and LiveKit Cloud. Custom voice cloning available once your
            organization is approved by OpenAI Custom Voices — until then, the
            translated voice automatically mimics the speaker&apos;s tone and
            cadence.
          </p>
        </footer>
      </div>
    </main>
  );
}

function EntryCard({
  href, icon: Icon, kicker, title, body, cta,
}: {
  href: string;
  icon: typeof Mic2;
  kicker: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group relative card hover:border-accent-700 hover:bg-ink-900/75 transition-all duration-200 ease-snap overflow-hidden"
    >
      <div className="absolute right-5 top-5 h-9 w-9 rounded-xl bg-accent-900/40 ring-1 ring-accent-700/40 flex items-center justify-center transition-all group-hover:bg-accent-800/60">
        <Icon className="h-4 w-4 text-accent-300" />
      </div>
      <div className="eyebrow">{kicker}</div>
      <div className="mt-2 text-xl font-semibold tracking-tightish">{title}</div>
      <p className="mt-2 text-sm text-ink-300 leading-relaxed max-w-sm">{body}</p>
      <div className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent-300 group-hover:text-accent-200">
        {cta}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function Highlight({
  icon: Icon, title, body,
}: { icon: typeof Mic2; title: string; body: string }) {
  return (
    <div className="card">
      <div className="h-9 w-9 rounded-xl bg-ink-800/70 ring-1 ring-ink-700/60 flex items-center justify-center mb-3">
        <Icon className="h-4 w-4 text-ink-200" />
      </div>
      <div className="font-medium tracking-tightish">{title}</div>
      <p className="mt-1.5 text-sm text-ink-400 leading-relaxed">{body}</p>
    </div>
  );
}
