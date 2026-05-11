'use client';

import { useEffect, useState } from 'react';
import { Headphones, Radio } from 'lucide-react';

const FLOW = [
  { en: 'Grace and peace to you, from our Father.',                   es: 'Gracia y paz a vosotros, de parte de nuestro Padre.',        pt: 'Graça e paz a vós, da parte de nosso Pai.' },
  { en: 'Today we open the Gospel of Luke, chapter 15.',              es: 'Hoy abrimos el Evangelio de Lucas, capítulo 15.',           pt: 'Hoje abrimos o Evangelho de Lucas, capítulo 15.' },
  { en: 'The shepherd leaves the ninety-nine to find the one.',       es: 'El pastor deja a las noventa y nueve para hallar a la una.',pt: 'O pastor deixa as noventa e nove para encontrar a única.' },
  { en: 'And there is rejoicing in heaven over one who returns.',     es: 'Y hay gozo en el cielo por uno que regresa.',                pt: 'E há alegria no céu por aquele que regressa.' },
];

export function LiveDemo() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % FLOW.length), 3600);
    return () => clearInterval(t);
  }, []);
  const line = FLOW[idx]!;

  return (
    <div className="card-elev relative overflow-hidden">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent-700/20 blur-3xl pointer-events-none" aria-hidden />

      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-ink-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-70" />
            <span className="relative h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          Live preview
        </span>
        <span className="font-mono text-[11px] text-ink-500">SVC-7K2L</span>
      </div>

      <div className="grid gap-3">
        <DemoRow
          flag="🇺🇸"
          label="Source · English"
          icon={<Radio className="h-3 w-3" />}
          text={line.en}
          eyebrow
          key={`en-${idx}`}
        />
        <DemoRow
          flag="🇪🇸"
          label="Listening · Español"
          icon={<Headphones className="h-3 w-3" />}
          text={line.es}
          highlight
          key={`es-${idx}`}
        />
        <DemoRow
          flag="🇧🇷"
          label="Listening · Português"
          icon={<Headphones className="h-3 w-3" />}
          text={line.pt}
          key={`pt-${idx}`}
        />
      </div>
    </div>
  );
}

function DemoRow({
  flag, label, icon, text, highlight, eyebrow,
}: {
  flag: string;
  label: string;
  icon: React.ReactNode;
  text: string;
  highlight?: boolean;
  eyebrow?: boolean;
}) {
  return (
    <div
      className={
        'rounded-xl border bg-white/[0.02] p-3 ' +
        (highlight ? 'border-accent-700/40' : 'border-white/[0.04]')
      }
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-ink-500 mb-1">
        <span aria-hidden>{flag}</span>
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={
          'leading-snug text-pretty caption-in ' +
          (eyebrow ? 'text-sm text-ink-200' : 'text-base font-medium text-ink-50')
        }
      >
        {text}
      </div>
    </div>
  );
}
