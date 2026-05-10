export type LanguageCode =
  | 'en' | 'es' | 'pt' | 'fr' | 'de' | 'it' | 'nl' | 'pl' | 'ru' | 'uk'
  | 'tr' | 'ar' | 'fa' | 'he' | 'hi' | 'bn' | 'ur' | 'vi' | 'th' | 'id'
  | 'ms' | 'tl' | 'zh' | 'ja' | 'ko' | 'sw' | 'am' | 'ha' | 'yo' | 'zu';

export interface Language {
  code: LanguageCode;
  englishName: string;
  nativeName: string;
  rtl?: boolean;
  /**
   * Supported as a target (output) language by gpt-realtime-translate.
   * Subset of OpenAI's 13 supported output languages as of May 2026.
   */
  realtimeTarget: boolean;
}

export const LANGUAGES: ReadonlyArray<Language> = [
  { code: 'en', englishName: 'English', nativeName: 'English', realtimeTarget: true },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', realtimeTarget: true },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', realtimeTarget: true },
  { code: 'fr', englishName: 'French', nativeName: 'Français', realtimeTarget: true },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch', realtimeTarget: true },
  { code: 'it', englishName: 'Italian', nativeName: 'Italiano', realtimeTarget: true },
  { code: 'nl', englishName: 'Dutch', nativeName: 'Nederlands', realtimeTarget: true },
  { code: 'pl', englishName: 'Polish', nativeName: 'Polski', realtimeTarget: true },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский', realtimeTarget: true },
  { code: 'uk', englishName: 'Ukrainian', nativeName: 'Українська', realtimeTarget: true },
  { code: 'tr', englishName: 'Turkish', nativeName: 'Türkçe', realtimeTarget: true },
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', rtl: true, realtimeTarget: true },
  { code: 'fa', englishName: 'Persian', nativeName: 'فارسی', rtl: true, realtimeTarget: false },
  { code: 'he', englishName: 'Hebrew', nativeName: 'עברית', rtl: true, realtimeTarget: false },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', realtimeTarget: false },
  { code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', realtimeTarget: false },
  { code: 'ur', englishName: 'Urdu', nativeName: 'اردو', rtl: true, realtimeTarget: false },
  { code: 'vi', englishName: 'Vietnamese', nativeName: 'Tiếng Việt', realtimeTarget: false },
  { code: 'th', englishName: 'Thai', nativeName: 'ไทย', realtimeTarget: false },
  { code: 'id', englishName: 'Indonesian', nativeName: 'Bahasa Indonesia', realtimeTarget: false },
  { code: 'ms', englishName: 'Malay', nativeName: 'Bahasa Melayu', realtimeTarget: false },
  { code: 'tl', englishName: 'Tagalog', nativeName: 'Tagalog', realtimeTarget: false },
  { code: 'zh', englishName: 'Mandarin Chinese', nativeName: '中文', realtimeTarget: true },
  { code: 'ja', englishName: 'Japanese', nativeName: '日本語', realtimeTarget: true },
  { code: 'ko', englishName: 'Korean', nativeName: '한국어', realtimeTarget: true },
  { code: 'sw', englishName: 'Swahili', nativeName: 'Kiswahili', realtimeTarget: false },
  { code: 'am', englishName: 'Amharic', nativeName: 'አማርኛ', realtimeTarget: false },
  { code: 'ha', englishName: 'Hausa', nativeName: 'Hausa', realtimeTarget: false },
  { code: 'yo', englishName: 'Yoruba', nativeName: 'Yorùbá', realtimeTarget: false },
  { code: 'zu', englishName: 'Zulu', nativeName: 'isiZulu', realtimeTarget: false },
];

export const LANGUAGES_BY_CODE: Record<LanguageCode, Language> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l]),
) as Record<LanguageCode, Language>;

export function getLanguage(code: string): Language | undefined {
  return LANGUAGES_BY_CODE[code as LanguageCode];
}

export const REALTIME_TARGET_LANGUAGES = LANGUAGES.filter((l) => l.realtimeTarget);
