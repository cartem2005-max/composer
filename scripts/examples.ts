// Собирает примеры композиций в examples/ тем же кодом, что и сервис: подбор → раскладка → SVG.
// Метафоры подбирает настоящая функция api/pick.ts (нужен ключ в .env.local, ≈ 0,05 цента за все примеры);
// без ключа — запасной словарь, как и в сервисе. Ответ ИИ немного меняется от запуска к запуску, поэтому
// у примеров записан ответ, который ИИ дал на сайте 03.11.2026 (его же видно в демо): пример не меняется при пересборке.
// Запуск: npm run examples

import fs from 'node:fs';
import handler from '../api/pick';
import { autoLayout } from '../src/layout';
import { sanitizePicks } from '../src/match/catalog';
import { pickByDictionary, pickByNames } from '../src/match/pick';
import { compositionSvg } from '../src/render';
import type { Composition, FormatId, LayoutId, Pick, SizeKey } from '../src/types';

for (const line of (fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

async function pickAI(text: string): Promise<{ picks: Pick[]; source: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { picks: pickByDictionary(text).picks, source: 'словарь' };
  const body: any = await new Promise(resolve =>
    handler({ method: 'POST', headers: {}, body: { text } }, { status() { return this; }, json: resolve }));
  const picks = sanitizePicks(body.picks);
  return picks.length ? { picks, source: 'ИИ' } : { picks: pickByDictionary(text).picks, source: 'словарь' };
}

interface Example { file: string; input: string; mode: 'metaphor' | 'names'; format: FormatId; layout: LayoutId; scheme: string; size: SizeKey; seed: number; picks?: Pick[] }

const examples: Example[] = [
  { file: '01-учиться-по-вечерам', input: 'Учиться по вечерам после работы', mode: 'metaphor', format: 'og', layout: 'compact', scheme: 'violet', size: 'L', seed: 1,
    picks: [{ id: 'book', variant: 'main' }, { id: 'lamp', variant: 'main' }] },
  { file: '02-весенняя-распродажа-цветов', input: 'Весенняя распродажа цветов', mode: 'metaphor', format: 'square', layout: 'offset', scheme: 'teal', size: 'L', seed: 0,
    picks: [{ id: 'tulips', variant: 'main' }, { id: 'coin', variant: 'bg' }] },
  { file: '03-отпуск-без-телефона', input: 'Отпуск без телефона', mode: 'metaphor', format: 'og', layout: 'compact', scheme: 'peach', size: 'L', seed: 0,
    picks: [{ id: 'headphones', variant: 'main' }, { id: 'tulips', variant: 'bg' }] },
];

fs.mkdirSync('examples', { recursive: true });
const lines: string[] = [];
for (const e of examples) {
  const { picks, source } = e.picks ? { picks: e.picks, source: 'ИИ на сайте, 03.11' }
    : e.mode === 'names' ? { picks: pickByNames(e.input).picks, source: 'разбор списка' } : await pickAI(e.input);
  const { scale, items } = autoLayout(picks, e.format, e.layout, e.size, e.seed);
  const c: Composition = {
    format: e.format, layout: e.layout, size: e.size, schemeId: e.scheme, background: 'bg1', scale, decor: true, seed: e.seed,
    items: items.map((it, i) => ({ ...it, uid: i + 1 })),
  };
  fs.writeFileSync(`examples/${e.file}.svg`, compositionSvg(c, { forExport: true }));
  lines.push(`- \`${e.file}.svg\` — «${e.input}» (${source}): ${picks.map(p => p.id + (p.variant === 'bg' ? ' (фон)' : '')).join(', ')}; ${e.format}, ${e.layout}, ${e.scheme}, ${e.size}`);
}
console.log(lines.join('\n'));
