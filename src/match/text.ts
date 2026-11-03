// Нормализация пользовательского текста перед разбором.

// Латиница, похожая на кириллицу, и наоборот: «Teлeфoн», «реn».
const LAT_TO_CYR: Record<string, string> = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у' };
const CYR_TO_LAT: Record<string, string> = Object.fromEntries(Object.entries(LAT_TO_CYR).map(([l, c]) => [c, l]));
// Белорусские и украинские буквы → русские, чтобы «кніга» нашлась как «книга».
const LETTERS: Record<string, string> = { 'і': 'и', 'ї': 'и', 'є': 'е', 'ў': 'у', 'ґ': 'г', 'ё': 'е' };

// Эмодзи вместо названий.
const EMOJI: [RegExp, string][] = [
  [/[📚📖📕📗📘📙📓📔]/gu, ' книга '],
  [/[📱📲☎📞]/gu, ' телефон '],
  [/🧩/gu, ' пазл '],
  [/[🪙💰💲]/gu, ' монета '],
  [/🎧/gu, ' наушники '],
  [/[💡🪔🔦]/gu, ' лампа '],
  [/[🌷💐]/gu, ' тюльпаны '],
  [/👛/gu, ' кошелек '],
  [/[📁📂🗂]/gu, ' папка '],
  [/[🖊🖋✒✏]/gu, ' ручка '],
];

/**
 * Приводит текст к виду для поиска: нижний регистр, без ударений и невидимых символов,
 * ё → е, белорусские и украинские буквы → русские, эмодзи → слова.
 */
export function normalize(s: string): string {
  let t = s.normalize('NFD').replace(/[̀́̈]/g, '').normalize('NFC').toLowerCase();
  t = t.replace(/[​-‏⁠﻿‪-‮⁦-⁩]|[\u{E0000}-\u{E007F}]/gu, '');
  for (const [re, word] of EMOJI) t = t.replace(re, word);
  return t.replace(/[іїєўґё]/g, ch => LETTERS[ch]);
}

/** Слова текста. Слово, где смешаны алфавиты, даётся в двух вариантах — кириллицей и латиницей. */
export function wordsOf(s: string): string[][] {
  return (normalize(s).match(/[a-zа-я0-9]+/g) ?? []).map(w => {
    const mixed = /[a-z]/.test(w) && /[а-я]/.test(w);
    if (!mixed) return [w];
    return [[...w].map(ch => LAT_TO_CYR[ch] ?? ch).join(''), [...w].map(ch => CYR_TO_LAT[ch] ?? ch).join('')];
  });
}

/** Обрезка по символам, а не по половинкам UTF-16: эмодзи на границе не разрезается. */
export function sliceChars(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('');
}
