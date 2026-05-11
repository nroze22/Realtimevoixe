import Link from 'next/link';
import {
  ArrowRight,
  Cable,
  Headphones,
  Languages,
  Mic2,
  QrCode,
  Radio,
  ShieldCheck,
  Sparkles,
  Waves,
} from 'lucide-react';
import { Logo } from '@/components/logo';
import { LiveDemo } from '@/components/live-demo';

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden">
      {/* Animated mesh backdrop */}
      <div className="pointer-events-none absolute inset-0 mesh opacity-90" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 -top-24 h-[60vh] bg-gradient-to-b from-accent-900/10 to-transparent" aria-hidden />

      {/* Top nav */}
      <header className="relative z-10 mx-auto max-w-6xl px-6 pt-6 flex items-center justify-between">
        <Logo withWordmark animated />
        <div className="flex items-center gap-2 text-sm">
          <Link href="/listen" className="btn btn-ghost h-9 px-3 text-xs">
            <Headphones className="h-3.5 w-3.5" /> Listener
          </Link>
          <Link href="/operator/new" className="btn btn-primary h-9 px-3 text-xs">
            <Mic2 className="h-3.5 w-3.5" /> Start a service
          </Link>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-6xl px-6 pt-14 md:pt-20 pb-24">
        {/* Hero */}
        <section className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] items-center">
          <div className="animate-fade-in">
            <span className="chip mb-6">
              <Sparkles className="h-3 w-3 text-accent-300" />
              OpenAI Realtime · LiveKit · live now
            </span>
            <h1 className="text-5xl md:text-[5.5rem] font-semibold tracking-tightish text-balance leading-[0.95]">
              Your sermon,
              <br />
              <span className="grad-accent-text">instantly</span>,
              <br />
              in every language.
            </h1>
            <p className="mt-6 text-lg text-ink-300 max-w-xl text-pretty leading-relaxed">
              Plug your soundboard into a laptop and your congregation hears the
              message in their own language on their own phones — within seconds.
              No headsets to rent. No interpreters to schedule.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/operator/new" className="btn btn-primary btn-lg group">
                <Mic2 className="h-5 w-5" /> Start a service
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link href="/listen" className="btn btn-ghost btn-lg">
                <Headphones className="h-5 w-5" /> I&apos;m a listener
              </Link>
            </div>

            <div className="mt-10 grid grid-cols-3 gap-6 max-w-md">
              <Stat number="13+" label="languages" />
              <Stat number="~1.2s" label="end-to-end" />
              <Stat number="$30" label="default cap" />
            </div>
          </div>

          <div className="relative">
            <div className="float">
              <LiveDemo />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mt-28 md:mt-32">
          <div className="flex items-end justify-between mb-10">
            <div>
              <span className="eyebrow">How it works</span>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tightish mt-2 text-balance">
                Three steps. About one minute.
              </h2>
            </div>
          </div>
          <ol className="grid gap-4 md:grid-cols-3">
            <Step
              n={1}
              icon={Cable}
              title="Plug in your audio"
              body="Take a mono aux send from your mixer into any USB audio interface. We test the signal before you go live."
            />
            <Step
              n={2}
              icon={QrCode}
              title="Share the code"
              body="A short SVC-XXXX code and QR appear on screen. Print it, project it, or hand it to ushers — no app to install."
            />
            <Step
              n={3}
              icon={Headphones}
              title="Listeners pick a language"
              body="On their phones over Wi-Fi, or piped into your existing FM/IR headsets via a simple line-out."
            />
          </ol>
        </section>

        {/* Highlights */}
        <section className="mt-24 grid gap-4 md:grid-cols-3">
          <Highlight
            icon={Languages}
            title="Real-time translation"
            body="One source, many languages in parallel. The translated voice automatically adapts to the speaker's tone and cadence."
          />
          <Highlight
            icon={Radio}
            title="Phones or headsets"
            body="BYOD over Wi-Fi for most listeners; dedicated broadcast pages feed any FM, IR, or Wi-Fi assistive-listening transmitter."
          />
          <Highlight
            icon={ShieldCheck}
            title="Cost caps built in"
            body="A hard cap per service auto-stops translation before the bill runs away. Default $30, configurable per service."
          />
        </section>

        {/* Pricing strip */}
        <section className="mt-24 card-elev relative overflow-hidden">
          <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-accent-700/15 blur-3xl pointer-events-none" aria-hidden />
          <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr] items-center">
            <div>
              <span className="eyebrow">Honest pricing</span>
              <h2 className="text-2xl md:text-3xl font-semibold tracking-tightish mt-2 text-balance">
                You pay for what the speaker actually says.
              </h2>
              <p className="mt-3 text-ink-300 max-w-xl text-pretty leading-relaxed">
                Cost scales with active speech time and the number of target
                languages. A typical 60-minute service into Spanish costs
                roughly <span className="readout text-ink-50">$18</span>; three
                languages, around <span className="readout text-ink-50">$54</span>.
                Every service has a hard cap.
              </p>
            </div>
            <ul className="grid gap-2 text-sm">
              <PriceRow label="1 language · per minute"  value="~$0.30" />
              <PriceRow label="3 languages · per minute" value="~$0.90" />
              <PriceRow label="60-min sermon · 1 lang"   value="~$18" />
              <PriceRow label="60-min sermon · 3 langs" value="~$54" />
            </ul>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-24 pt-10 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-4 text-xs text-ink-500">
          <div className="flex items-center gap-3">
            <Logo withWordmark />
            <span className="text-ink-700">·</span>
            <span>Live translation for worship.</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Waves className="h-3 w-3" />
              <code className="font-mono text-ink-400">gpt-realtime-translate</code>
            </span>
            <span className="opacity-60">·</span>
            <span>LiveKit Cloud</span>
          </div>
        </footer>
      </div>
    </main>
  );
}

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div>
      <div className="text-2xl readout grad-text">{number}</div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-ink-500 mt-1">{label}</div>
    </div>
  );
}

function Step({
  n, icon: Icon, title, body,
}: { n: number; icon: typeof Cable; title: string; body: string }) {
  return (
    <li className="card relative">
      <div className="absolute -top-3 -left-3 h-7 w-7 rounded-lg bg-accent text-accent-fg grid place-items-center text-xs font-semibold shadow-glow">
        {n}
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="h-9 w-9 rounded-xl bg-accent-900/40 ring-1 ring-accent-700/40 grid place-items-center">
          <Icon className="h-4 w-4 text-accent-300" />
        </div>
        <h3 className="font-medium tracking-tightish text-lg">{title}</h3>
      </div>
      <p className="text-sm text-ink-400 leading-relaxed text-pretty">{body}</p>
    </li>
  );
}

function Highlight({
  icon: Icon, title, body,
}: { icon: typeof Cable; title: string; body: string }) {
  return (
    <div className="card hover:bg-ink-900/70 transition-all duration-200">
      <div className="h-9 w-9 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] grid place-items-center mb-3">
        <Icon className="h-4 w-4 text-ink-200" />
      </div>
      <div className="font-medium tracking-tightish">{title}</div>
      <p className="mt-1.5 text-sm text-ink-400 leading-relaxed text-pretty">{body}</p>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between border-b border-white/[0.04] last:border-0 py-2">
      <span className="text-ink-300">{label}</span>
      <span className="readout">{value}</span>
    </li>
  );
}
