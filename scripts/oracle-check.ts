// Проверка самих тестов (бесплатно, без ИИ).
// 1. Заведомо плохие ответы должны проваливаться: если «все 10 объектов» проходит — эталон слишком мягкий.
// 2. Базовые решения без ума (случайно, «самые частые», словарь) — чтобы цифра модели читалась как прирост над ними.
// Запуск: npx tsx scripts/oracle-check.ts

import fs from 'node:fs';
import { pickByDictionary } from '../src/match/pick';

interface Case { id: string; text: string; must?: string[][]; allowed?: string[]; kind: string; category?: string }
const IDS = ['book', 'phone', 'puzzle', 'coin', 'headphones', 'lamp', 'tulips', 'wallet', 'folder', 'pen'];
const load = (f: string): Case[] => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const sets: Record<string, Case[]> = {
  'отложенная 1': load('tests/holdout1/metaphors.json'),
  'отложенная 2': load('tests/holdout2/metaphors.json'),
  'отложенная 3': load('tests/holdout3/metaphors.json'),
  'все метафоры': [
    'tests/metaphors.json', 'tests/gpt/metaphors.json', 'tests/claude/metaphors.json',
    'tests/holdout1/metaphors.json', 'tests/holdout2/metaphors.json', 'tests/holdout3/metaphors.json',
  ].flatMap(load).filter(c => c.kind === 'metaphor'),
};

const pass = (c: Case, ids: string[]) =>
  ids.length > 0 && ids.every(id => !c.allowed || c.allowed.includes(id)) && (c.must ?? []).every(g => g.some(id => ids.includes(id)));

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const sample = (n: number) => [...IDS].sort(() => rnd() - 0.5).slice(0, n);

// «Самые частые объекты» — по эталонам рабочих (не отложенных) партий.
const freq = new Map<string, number>();
for (const c of [...load('tests/metaphors.json'), ...load('tests/gpt/metaphors.json'), ...load('tests/claude/metaphors.json')])
  for (const g of c.must ?? []) for (const id of g) freq.set(id, (freq.get(id) ?? 0) + 1);
const top = [...freq].sort((a, b) => b[1] - a[1]).map(([id]) => id);

const strategies: Record<string, (c: Case) => string[]> = {
  'пустой ответ': () => [],
  'все 10 объектов': () => IDS,
  'случайный 1 объект': () => sample(1),
  'случайные 2 объекта': () => sample(2),
  [`всегда самый частый (${top[0]})`]: () => [top[0]],
  [`всегда два частых (${top[0]}, ${top[1]})`]: () => [top[0], top[1]],
  'словарь ключевых слов (без ИИ)': c => pickByDictionary(c.text).picks.map(p => p.id),
};

const ci = (p: number, n: number) => Math.round(196 * Math.sqrt((p * (1 - p)) / n)); // 95 %, в п. п.
const lines = ['# Проверка тестов: плохие ответы и базовые решения', '', `Погрешность (95 %) на партии из 100 фраз при 85–90 % — около ±${ci(0.88, 100)} п. п.`, ''];
lines.push(`| решение | ${Object.keys(sets).join(' | ')} |`, `|---|${Object.keys(sets).map(() => '---').join('|')}|`);
for (const [name, fn] of Object.entries(strategies)) {
  seed = 7;
  const cells = Object.values(sets).map(cs => {
    const ok = cs.filter(c => pass(c, fn(c))).length;
    return `${Math.round((ok / cs.length) * 100)} % (${ok}/${cs.length})`;
  });
  lines.push(`| ${name} | ${cells.join(' | ')} |`);
}
fs.writeFileSync('tests/report-oracle.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));
