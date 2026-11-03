// Прогон фраз через настоящую серверную функцию api/pick.ts (Claude Haiku). Платно, запускается вручную.
//   npm run eval:ai -- --limit 5        короткая проверка
//   npm run eval:ai                     весь набор
// Ключ читается из .env.local (ANTHROPIC_API_KEY=...). Сам ключ нигде не печатается.
// Цена — оценка по ставкам PRICE_IN / PRICE_OUT ($ за 1 млн токенов), проверьте их в консоли Anthropic.

import fs from 'node:fs';
import crypto from 'node:crypto';
import handler from '../api/pick';

const env = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
for (const line of env.split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
if (!process.env.ANTHROPIC_API_KEY) { console.error('Нет ANTHROPIC_API_KEY в .env.local'); process.exit(1); }

// Цены Haiku 5.5 по прайсу Anthropic: $0,10 вход / $0,50 выход за 1 млн токенов.
const PRICE_IN = Number(process.env.PRICE_IN ?? 0.1), PRICE_OUT = Number(process.env.PRICE_OUT ?? 0.5);
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

interface Case { id: string; text: string; must?: string[][]; allowed?: string[]; kind: string; category?: string; generate?: boolean; note?: string }
const byCategory: Record<string, { total: number; ok: number }> = {};
const load = (f: string): Case[] => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);
const expand = (c: Case) => {
  const m = c.generate ? /^repeat:(.*):(\d+)$/s.exec(c.text) : null;
  return m ? m[1].repeat(Math.ceil(Number(m[2]) / Math.max(1, m[1].length))).slice(0, Number(m[2])) : c.text;
};
//   npm run eval:ai -- --failed          только проваленные в прошлом отчёте + наборы tests/claude
const all = [
  ...load('tests/holdout1/metaphors.json'), ...load('tests/holdout1/attacks.json'),
  ...load('tests/holdout2/metaphors.json'), ...load('tests/holdout2/attacks.json'),
  ...load('tests/holdout3/metaphors.json'), ...load('tests/holdout3/attacks.json'),
  ...load('tests/gpt/metaphors.json'), ...load('tests/metaphors.json').filter(c => c.kind !== 'names'), ...load('tests/gpt/attacks.json'),
  ...load('tests/claude/metaphors.json'), ...load('tests/claude/attacks.json'),
];
let selected = all;
if (process.argv.includes('--failed')) {
  const prev = fs.existsSync('tests/report-ai.md') ? fs.readFileSync('tests/report-ai.md', 'utf8') : '';
  const failed = new Set([...prev.matchAll(/^\| ([a-z]+\d+) \|/gm)].map(m => m[1]));
  const claudeIds = new Set([...load('tests/claude/metaphors.json'), ...load('tests/claude/attacks.json')].map(c => c.id));
  selected = all.filter(c => failed.has(c.id) || claudeIds.has(c.id));
  fs.copyFileSync('tests/report-ai.md', 'tests/report-ai-prev.md');
}
//   npm run eval:ai -- --holdout tests/holdout1   только новая отложенная партия (ИИ её раньше не видел)
const holdoutArg = process.argv.indexOf('--holdout');
if (holdoutArg > 0) {
  const dir = process.argv[holdoutArg + 1];
  selected = [...load(`${dir}/metaphors.json`), ...load(`${dir}/attacks.json`)];
}
const cases = selected.slice(0, limit);

function call(text: string): Promise<{ status: number; body: any }> {
  return new Promise(resolve => {
    const res = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve({ status: this.code, body: b }); } };
    handler({ method: 'POST', headers: { 'x-forwarded-for': `eval-${Math.random()}` }, body: { text } }, res);
  });
}

const rows: string[] = [];
let tokIn = 0, tokOut = 0, ok = 0, okAttack = 0, attacks = 0, errors = 0, outside = 0;
const ids = ['book', 'phone', 'puzzle', 'coin', 'headphones', 'lamp', 'tulips', 'wallet', 'folder', 'pen'];
const queue = [...cases];

async function worker() {
  for (let c = queue.shift(); c; c = queue.shift()) {
    const text = expand(c);
    const t0 = Date.now();
    const { status, body } = await call(text);
    const ms = Date.now() - t0;
    tokIn += body.usage?.input_tokens ?? 0; tokOut += body.usage?.output_tokens ?? 0;
    const picks: { id: string; variant: string }[] = body.picks ?? [];
    const got = picks.map(p => p.id);
    if (got.some(id => !ids.includes(id))) outside++;
    const missing = (c.must ?? []).filter(g => !g.some(id => got.includes(id)));
    const extra = c.allowed ? got.filter(id => !c.allowed!.includes(id)) : [];
    // Пустой текст сервер отклоняет (400) — для атак это правильное поведение.
    const pass = status === 200 ? !missing.length && !extra.length : c.kind === 'attack' && status === 400;
    if (status !== 200 && status !== 400) errors++;
    if (c.kind === 'attack') { attacks++; if (pass) okAttack++; } else if (pass) ok++;
    if (c.category) { const s = (byCategory[c.category] ??= { total: 0, ok: 0 }); s.total++; if (pass) s.ok++; }
    if (!pass) rows.push(`| ${c.id} | ${text.slice(0, 50).replace(/\|/g, '/')} | ${status} | ${picks.map(p => p.id + (p.variant === 'bg' ? '(bg)' : '')).join(', ') || body.error} | ${missing.map(g => g.join('/')).join('; ')}${extra.length ? ' лишние: ' + extra.join(',') : ''} | ${(body.reason ?? '').slice(0, 80)} |`);
    process.stdout.write(pass ? '.' : 'x');
    void ms;
  }
}

await Promise.all(Array.from({ length: 4 }, worker));
const cost = (tokIn * PRICE_IN + tokOut * PRICE_OUT) / 1e6;
const metaphors = cases.length - attacks;
const fingerprint = crypto.createHash('sha256').update(fs.readFileSync('api/pick.ts', 'utf8') + fs.readFileSync('src/match/negation.ts', 'utf8') + fs.readFileSync('src/match/catalog.ts', 'utf8')).digest('hex').slice(0, 12);
const summary = [
  `- модель: ${process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5'}, отпечаток промпта и кода: ${fingerprint}, дата: ${new Date().toISOString().slice(0, 16)} UTC, фраз: ${cases.length}`,
  `- метафоры: ${ok} из ${metaphors} (${Math.round((ok / Math.max(1, metaphors)) * 100)}%)`,
  `- атаки: ${okAttack} из ${attacks}`,
  `- ответов вне библиотеки: ${outside}`,
  `- ошибок сервера/сети: ${errors}`,
  ...Object.entries(byCategory).map(([k, s]) => `- категория ${k}: ${s.ok} из ${s.total}`),
  `- токены: ${tokIn} входных, ${tokOut} выходных; оценка ≈ $${cost.toFixed(3)} (ставки ${PRICE_IN}/${PRICE_OUT} за 1 млн)`,
].join('\n');
fs.writeFileSync(process.env.REPORT ?? 'tests/report-ai.md', `# Прогон фраз через ИИ (${process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5'})\n\n${summary}\n\n## Не совпало с эталоном\n\n| id | фраза | HTTP | выбрано | чего не хватило | объяснение ИИ |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
console.log('\n' + summary);
