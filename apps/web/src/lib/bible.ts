/**
 * Detect scripture references in caption text so they can be rendered as
 * tappable links. Supports common English book names (with common abbreviations
 * and "1/2/3"-prefixed books) plus Spanish equivalents.
 *
 * Captures references like:
 *   John 3:16
 *   1 Cor 13:4-7
 *   Salmos 23
 *   Juan 3:16-17
 *
 * The link target is YouVersion's web reader using the canonical OSIS code.
 */

const BOOK_ALIASES: Record<string, string> = {
  // Old Testament
  gen: 'GEN', genesis: 'GEN', génesis: 'GEN', genese: 'GEN',
  ex: 'EXO', exo: 'EXO', exod: 'EXO', exodus: 'EXO', éxodo: 'EXO',
  lev: 'LEV', leviticus: 'LEV',
  num: 'NUM', numbers: 'NUM',
  deut: 'DEU', dt: 'DEU', deuteronomy: 'DEU',
  josh: 'JOS', joshua: 'JOS', josué: 'JOS',
  judg: 'JDG', judges: 'JDG',
  ruth: 'RUT',
  '1sam': '1SA', '1samuel': '1SA',
  '2sam': '2SA', '2samuel': '2SA',
  '1kgs': '1KI', '1kings': '1KI',
  '2kgs': '2KI', '2kings': '2KI',
  '1chron': '1CH', '1chronicles': '1CH',
  '2chron': '2CH', '2chronicles': '2CH',
  ezra: 'EZR',
  neh: 'NEH', nehemiah: 'NEH',
  est: 'EST', esther: 'EST',
  job: 'JOB',
  ps: 'PSA', psa: 'PSA', psalm: 'PSA', psalms: 'PSA', salmo: 'PSA', salmos: 'PSA',
  prov: 'PRO', proverbs: 'PRO', proverbios: 'PRO',
  eccl: 'ECC', ecclesiastes: 'ECC',
  song: 'SNG', sos: 'SNG',
  isa: 'ISA', isaiah: 'ISA', isaías: 'ISA',
  jer: 'JER', jeremiah: 'JER', jeremías: 'JER',
  lam: 'LAM', lamentations: 'LAM',
  ezek: 'EZK', ezk: 'EZK', ezekiel: 'EZK',
  dan: 'DAN', daniel: 'DAN',
  hos: 'HOS', hosea: 'HOS',
  joel: 'JOL',
  amos: 'AMO',
  obad: 'OBA', obadiah: 'OBA',
  jonah: 'JON', jonás: 'JON',
  mic: 'MIC', micah: 'MIC',
  nah: 'NAM', nahum: 'NAM',
  hab: 'HAB', habakkuk: 'HAB',
  zeph: 'ZEP', zephaniah: 'ZEP',
  hag: 'HAG', haggai: 'HAG',
  zech: 'ZEC', zechariah: 'ZEC',
  mal: 'MAL', malachi: 'MAL',
  // New Testament
  mt: 'MAT', matt: 'MAT', matthew: 'MAT', mateo: 'MAT',
  mk: 'MRK', mark: 'MRK', marcos: 'MRK',
  lk: 'LUK', luke: 'LUK', lucas: 'LUK',
  jn: 'JHN', john: 'JHN', juan: 'JHN',
  acts: 'ACT', hechos: 'ACT',
  rom: 'ROM', romans: 'ROM', romanos: 'ROM',
  '1cor': '1CO', '1corinthians': '1CO', '1corintios': '1CO',
  '2cor': '2CO', '2corinthians': '2CO', '2corintios': '2CO',
  gal: 'GAL', galatians: 'GAL', gálatas: 'GAL',
  eph: 'EPH', ephesians: 'EPH', efesios: 'EPH',
  phil: 'PHP', philippians: 'PHP', filipenses: 'PHP',
  col: 'COL', colossians: 'COL', colosenses: 'COL',
  '1thess': '1TH', '1thessalonians': '1TH',
  '2thess': '2TH', '2thessalonians': '2TH',
  '1tim': '1TI', '1timothy': '1TI',
  '2tim': '2TI', '2timothy': '2TI',
  titus: 'TIT', tito: 'TIT',
  phlm: 'PHM', philemon: 'PHM',
  heb: 'HEB', hebrews: 'HEB', hebreos: 'HEB',
  james: 'JAS', santiago: 'JAS',
  '1pet': '1PE', '1peter': '1PE',
  '2pet': '2PE', '2peter': '2PE',
  '1jn': '1JN', '1john': '1JN',
  '2jn': '2JN', '2john': '2JN',
  '3jn': '3JN', '3john': '3JN',
  jude: 'JUD', judas: 'JUD',
  rev: 'REV', revelation: 'REV', apocalipsis: 'REV',
};

// Match "<book> <ch>[:<v>[-<v2>]]" with optional 1/2/3 prefix.
// Built to be permissive about case and dot in abbreviation.
const REF_REGEX = /\b((?:[1-3]\s?)?[A-Za-zÀ-ÿ]{2,15})\.?\s+(\d{1,3})(?::(\d{1,3})(?:[\-–](\d{1,3}))?)?\b/g;

export interface Match {
  /** Full matched substring. */
  match: string;
  index: number;
  href: string;
}

export function findScriptureRefs(text: string): Match[] {
  const out: Match[] = [];
  if (!text) return out;
  let m: RegExpExecArray | null;
  REF_REGEX.lastIndex = 0;
  while ((m = REF_REGEX.exec(text)) !== null) {
    const full = m[0];
    const book = m[1];
    const chapter = m[2];
    const verse = m[3];
    if (!book || !chapter) continue;
    const normalized = book.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
    const code = BOOK_ALIASES[normalized];
    if (!code) continue;
    let path = `${code}.${chapter}`;
    if (verse) path += `.${verse}`;
    const href = `https://www.bible.com/bible/1/${path}`;
    out.push({ match: full, index: m.index ?? 0, href });
  }
  return out;
}

/** Split text into ordered chunks of plain strings + scripture links. */
export type TextPart = { type: 'text'; text: string } | { type: 'ref'; text: string; href: string };

export function annotateScripture(text: string): TextPart[] {
  if (!text) return [];
  const refs = findScriptureRefs(text);
  if (refs.length === 0) return [{ type: 'text', text }];
  const out: TextPart[] = [];
  let cursor = 0;
  for (const r of refs) {
    if (r.index > cursor) out.push({ type: 'text', text: text.slice(cursor, r.index) });
    out.push({ type: 'ref', text: r.match, href: r.href });
    cursor = r.index + r.match.length;
  }
  if (cursor < text.length) out.push({ type: 'text', text: text.slice(cursor) });
  return out;
}
