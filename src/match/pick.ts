import type { ObjectId, Pick, PickResult } from '../types';
import { CATALOG, cleanInput, sanitizePicks } from './catalog.js';
import { THEMES } from './dictionary.js';
import { NAMES } from './names.js';
export { NAMES };
import { negatedObjects } from './negation.js';
import { normalize, sliceChars, wordsOf } from './text.js';

// Короткие латинские основы (pen, cup) сравниваем целым словом, иначе pen находит pencil и pension.
const stemHit = (w: string, st: string) => (/^[a-z]{1,3}$/.test(st) ? w === st || w === st + 's' : w.startsWith(st));
const anyHit = (variants: string[], stems: string[]) => variants.some(w => stems.some(st => stemHit(w, st)));
const hits = (ws: string[][], stems: string[]) => ws.filter(v => anyHit(v, stems)).length;


/** Сценарий 1 без ИИ: объекты, чьи темы и названия встречаются во фразе. */
export function pickByDictionary(text: string): PickResult {
  const ws = wordsOf(cleanInput(text));
  const negated = negatedObjects(cleanInput(text));
  const scored = CATALOG.filter(c => !negated.includes(c.id)).map(c => ({
    id: c.id,
    score: hits(ws, NAMES[c.id]) * 3 + hits(ws, THEMES[c.id]),
  }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    // Нейтральный набор, без отрицаемых во фразе объектов («Офис без лампочек» — не лампа).
    const neutral = (['lamp', 'book', 'puzzle', 'tulips'] as ObjectId[]).filter(id => !negated.includes(id)).slice(0, 2);
    return {
      picks: sanitizePicks(neutral.map((id, i) => ({ id, variant: i ? 'bg' : 'main' }))),
      source: 'dictionary',
      reason: 'Подходящих слов не нашлось, поэтому показан нейтральный набор.',
    };
  }
  const picks: Pick[] = scored.slice(0, 4).map((s, i) => ({ id: s.id, variant: i < 3 ? 'main' : 'bg' }));
  return { picks: sanitizePicks(picks), source: 'dictionary', reason: '' };
}

/** Расстояние Левенштейна — чтобы «нашуники» и «тюлпаны» тоже находились. */
function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// Пометки вида объекта. Сравниваются целым словом: «фонарь» и «фона» (в «без фона») — не пометки.
const BG_MARKS = new Set(['фон', 'фоном', 'фоне', 'фоновый', 'фоновая', 'фоновое', 'фоновые', 'фоновую', 'фоновых', 'фоновым', 'фоновой', 'фоновыми',
  'background', 'bg', 'сзади', 'позади', 'монохром', 'монохромный', 'монохромная', 'монохромное', 'монохромные', 'монохромную', 'монохромных']);
const MAIN_MARKS = new Set(['главный', 'главная', 'главное', 'главные', 'главную', 'main', 'впереди', 'спереди', 'цветной', 'цветная', 'цветное', 'цветные']);
const NEGATIONS = new Set(['без', 'не', 'кроме', 'вместо', 'никаких', 'никакой', 'никакого', 'without', 'not', 'except', 'no', 'ohne']);
// Отказ от объекта, сказанный после него или глаголом: «книги нет», «лампу не надо», «книгу убери».
const DROP_WORDS = ['нет', 'убер', 'убир', 'удал', 'remove', 'delete'];
const ALL_WORDS = new Set(['оба', 'обе', 'все', 'всё', 'both', 'all']);
// Служебные слова между объектом и пометкой: «лампа на фоне», «книга в фоне».
const FILLERS = new Set(['на', 'в', 'во', 'с', 'со', 'как', 'это', 'the', 'a', 'as', 'in', 'on', 'at']);
const isMark = (w: string) => BG_MARKS.has(w) || MAIN_MARKS.has(w) || NEGATIONS.has(w);

function matchName(variants: string[]): ObjectId | null {
  if (variants.some(isMark)) return null;
  let best: { id: ObjectId; d: number } | null = null;
  for (const word of variants) {
    for (const c of CATALOG) {
      for (const stem of NAMES[c.id]) {
        if (stemHit(word, stem)) return c.id;
        // Пропущенная гласная в коротком слове: «кнга», «лмпу», «рчка». Остаток — три согласные, поэтому «папа» и «наша» не задеваются.
        if (word.length === 4 && stem.length === 4 && /^[бвгджзйклмнпрстфхцчшщ]{3}[аеёиоуыэюя]$/.test(word)
          && [1, 2, 3].some(i => /[аеёиоуыэюя]/.test(stem[i]) && stem.slice(0, i) + stem.slice(i + 1) === word.slice(0, 3))) return c.id;
        // Опечатки: основа против начала слова той же длины (±1 буква), чтобы окончание не стоило правки.
        // Короткие слова не исправляем («папа» — не «папка»), первая буква должна совпасть («велосипед» — не «мелочи»).
        if (stem.length < 4 || word.length < 5 || word[0] !== stem[0]) continue;
        const d = Math.min(...[stem.length - 1, stem.length, stem.length + 1].map(n => lev(word.slice(0, n), stem)));
        if (d <= (stem.length >= 7 ? 2 : 1) && (!best || d < best.d)) best = { id: c.id, d };
      }
    }
  }
  return best?.id ?? null;
}

type Token = { kind: 'obj'; id: ObjectId } | { kind: 'bg' | 'main' | 'neg' | 'drop' | 'all' | 'word' };

function tokenize(part: string): Token[] {
  const out: Token[] = [];
  const ws = wordsOf(part);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i][0];
    if (FILLERS.has(w)) continue;
    const next = ws[i + 1]?.[0] ?? '';
    const prev = ws[i - 1]?.[0] ?? '';
    // «на заднем плане», «на заднем — монеты», «на переднем плане»
    if (w === 'заднем' || w === 'задний') { out.push({ kind: 'bg' }); if (next.startsWith('план')) i++; continue; }
    if (w === 'переднем' || w === 'передний') { out.push({ kind: 'main' }); if (next.startsWith('план')) i++; continue; }
    // «без фона» — отказ от фона: не пометка фоном и не отрицание следующего объекта.
    if (NEGATIONS.has(w) && /^фон(а|у|ом)?$/.test(next)) { out.push({ kind: 'main' }); i++; continue; }
    // «лампу не надо», «книга не нужна» — отказ от уже названного объекта.
    if (w === 'не' && /^(надо|нужн)/.test(next)) { out.push({ kind: 'drop' }); i++; continue; }
    // «ни одного кошелька»
    if (w === 'ни' && /^одн/.test(next)) { out.push({ kind: 'neg' }); i++; continue; }
    // «ничего кроме книги» = только книга; «кроме того» = ещё. Это не отрицания.
    if (w === 'кроме' && (['ничего', 'никого', 'только'].includes(prev) || ['того', 'этого', 'всего'].includes(next))) {
      if (['того', 'этого'].includes(next)) i++;
      continue;
    }
    if (BG_MARKS.has(w)) out.push({ kind: 'bg' });
    else if (MAIN_MARKS.has(w)) out.push({ kind: 'main' });
    else if (NEGATIONS.has(w)) out.push({ kind: 'neg' });
    else if (DROP_WORDS.some(d => w.startsWith(d))) out.push({ kind: 'drop' });
    else if (ALL_WORDS.has(w)) out.push({ kind: 'all' });
    else {
      const id = matchName(ws[i]);
      out.push(id ? { kind: 'obj', id } : { kind: 'word' });
    }
  }
  return out;
}

const SEP = /(,|\+|\/|\t|\sи\s|\sand\s|\sund\s|\s&\s|\sа\s|\sно\s)/;
// Разделители, после которых перечисление продолжается одним списком: «книгу и ручку убери».
const CHAIN_SEP = /^(\+|\sи\s|\sand\s|\sund\s|\s&\s)$/;
const STICKY_BG = /(?:^|\s)(фоновые|фоновый|фоновая|фоном|фоне|фон|background|bg)\s*:/;

/**
 * Сценарий 2: пользователь перечисляет компоненты в свободной форме.
 * «книга, лампа и ручка», «телефон + монеты», «фоновая лампа», «лампа (фон)», «книга; фоновые: лампа, ручка»,
 * «без лампы: книга и ручка», «книги нет, есть лампа», «книгу и ручку убери», «book:bg, pen:main»,
 * с опечатками, эмодзи и буквами-двойниками.
 * - Пометка вида относится к ближайшему объекту: сначала после него («папка с документами сзади»), потом перед ним.
 *   Пометка отдельной частью («книга, наушники, но фоновые») — к предыдущему объекту, со словом «оба/both» — ко всем.
 * - Повтор объекта с пометкой меняет его вид, а не добавляет копию: «кошелёк и монеты, монеты монохромные».
 * - Отрицание («без», «не», «вместо», «никаких») убирает следующий объект, если тот не назван где-то ещё прямо;
 *   отказ после объекта («нет», «не надо», «убери») убирает объекты своей части и связанные с ней через «и».
 */
export function pickByNames(text: string): PickResult {
  // Сначала делим по строкам и разделителям, потом чистим: cleanInput превращает перенос строки в пробел.
  const raw = sliceChars(typeof text === 'string' ? text : '', 600);
  const prepared = normalize(raw)
    .replace(/черно-бел\S*/g, 'монохромный')
    // «кошелёк-монетница» — один объект: берём первую часть составного слова.
    .replace(/([a-zа-я]+)-[a-zа-я]+/g, '$1');
  const picks: Pick[] = [];
  const soft = new Set<ObjectId>(); // отрицания «без X»: уступают прямому упоминанию
  const hard = new Set<ObjectId>(); // отказ «X нет», «убери X»
  const positive = new Set<ObjectId>();
  const unknown: string[] = [];
  let partsSeen = 0;
  let repeats = 0; // повторное упоминание без пометки вида: «книга, книга»
  const setVariant = (id: ObjectId, variant: Pick['variant']) => {
    const p = picks.find(x => x.id === id);
    if (p) p.variant = variant;
  };
  for (const group of prepared.split(/[;\n\r|]|\.\s+/)) {
    // «фоновые: лампа, ручка» — пометка с двоеточием действует до конца группы.
    const sticky = STICKY_BG.exec(group);
    let groupBg = false;
    let chain: ObjectId[] = [];
    let lastSep = '';
    const groupStart = picks.length;
    for (const piece of group.split(SEP)) {
      if (SEP.test(piece) && piece.trim().length <= 3) { lastSep = piece; continue; }
      if (!CHAIN_SEP.test(lastSep)) chain = [];
      let text = piece;
      if (sticky && STICKY_BG.test(text)) { groupBg = true; text = text.replace(STICKY_BG, ' '); }
      const part = cleanInput(text);
      if (!part || ++partsSeen > 30) continue;
      const tokens = tokenize(part);
      const objs = tokens.filter((t): t is { kind: 'obj'; id: ObjectId } => t.kind === 'obj');
      // Часть без объектов, только с пометкой: относится к предыдущему объекту или, с «оба/both», ко всем в группе.
      if (!objs.length) {
        const mark = tokens.find(t => t.kind === 'bg' || t.kind === 'main')?.kind as 'bg' | 'main' | undefined;
        if (mark && picks.length > groupStart) {
          const targets = tokens.some(t => t.kind === 'all') ? picks.slice(groupStart) : [picks[picks.length - 1]];
          targets.forEach(p => { p.variant = mark; });
        } else if (tokens.some(t => t.kind === 'word')) unknown.push(part);
        continue;
      }
      if (tokens.some(t => t.kind === 'drop')) {
        for (const id of [...objs.map(o => o.id), ...chain]) hard.add(id);
        chain = [];
        continue;
      }
      let negate = false;
      tokens.forEach((tk, i) => {
        if (tk.kind === 'neg') { negate = true; return; }
        if (tk.kind !== 'obj') return;
        if (negate) { soft.add(tk.id); negate = false; return; }
        // Пометка — ближайшая к объекту: сначала после него, потом перед ним; поиск не перескакивает через объект.
        const near = (from: number, step: 1 | -1) => {
          for (let j = from, n = 0; j >= 0 && j < tokens.length && n < 3; j += step, n++) {
            const k = tokens[j].kind;
            if (k === 'obj' || k === 'neg') return undefined;
            if (k === 'bg' || k === 'main') return k;
          }
          return undefined;
        };
        const mark = near(i + 1, 1) ?? near(i - 1, -1);
        positive.add(tk.id);
        chain.push(tk.id);
        if (picks.some(p => p.id === tk.id)) { if (mark) setVariant(tk.id, mark); else repeats++; return; }
        picks.push({ id: tk.id, variant: mark ?? (groupBg ? 'bg' : 'main') });
      });
    }
  }
  const excluded = (id: ObjectId) => hard.has(id) || (soft.has(id) && !positive.has(id));
  const wanted = picks.filter(p => !excluded(p.id));
  const clean = sanitizePicks(wanted);
  // Честно объясняем, что изменили правила композиции: лимит объектов и «хотя бы один главный».
  const notes: string[] = [];
  const distinct = new Set(wanted.map(p => p.id)).size;
  if (distinct > clean.length) notes.push(`Показаны первые ${clean.length} из ${distinct}: в одной композиции до ${clean.length} объектов.`);
  if (wanted.length && wanted.every(p => p.variant === 'bg') && clean.some(p => p.variant === 'main'))
    notes.push('Первый объект сделан главным: в композиции нужен хотя бы один главный.');
  if (clean.filter(p => p.variant === 'bg').length > wanted.filter(p => p.variant === 'bg').length && !notes.length)
    notes.push('Четвёртый и следующие главные объекты стали фоновыми: главных в композиции не больше трёх.');
  // «две книги», «книга, книга» — копии не создаются: каждый объект берётся один раз.
  const repeated = repeats > 0 || /(^|[\s,])(\d+|два|две|три|четыре|пять|шесть|несколько|много)\s/i.test(raw);
  if (repeated) notes.push('Каждый объект добавлен один раз — копии делает кнопка «Дублировать» (Ctrl+D).');
  if (unknown.length) notes.push(`Не нашлось в библиотеке: ${unknown.join(', ')}.`);
  const reason = clean.length
    ? notes.join(' ') || 'Все компоненты найдены.'
    : 'Таких объектов в библиотеке нет. Доступны: ' + CATALOG.map(c => c.name.toLowerCase()).join(', ') + '.';
  return { picks: clean, source: 'dictionary', reason };
}

/** Сценарий 1 с ИИ. Любая ошибка (нет ключа, сеть, тайм-аут, кривой ответ) — переход на словарь. */
export async function pickWithAI(text: string, timeoutMs = 12000): Promise<PickResult> {
  const input = cleanInput(text);
  if (!input) return pickByDictionary('');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch('/api/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const picks = sanitizePicks(data.picks);
    if (!picks.length) throw new Error('пустой ответ');
    return { picks, source: 'ai', reason: typeof data.reason === 'string' ? data.reason.slice(0, 300) : '' };
  } catch (e) {
    const fallback = pickByDictionary(input);
    const why = (e as Error).name === 'AbortError' ? 'не ответил вовремя' : 'сейчас недоступен';
    console.warn('pick: ИИ недоступен, словарь', e);
    return { ...fallback, reason: `ИИ ${why}, поэтому сработал запасной словарь. ${fallback.reason}`.trim() };
  } finally {
    clearTimeout(timer);
  }
}
