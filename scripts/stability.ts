// Шум модели: одни и те же фразы прогоняются несколько раз, считаем, где ответ меняется.
// Такие фразы — «нестабильные»: их провал в одном прогоне не считается регрессией.
// Запуск (платно, ≈ 1 цент): npx tsx scripts/stability.ts [число фраз] [повторов]

import fs from 'node:fs';
import crypto from 'node:crypto';
import handler from '../api/pick';

for (const line of (fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '').split(/\r?\n/)) {
  const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const N = Number(process.argv[2] ?? 40), R = Number(process.argv[3] ?? 3);
const cases: { id: string; text: string }[] = ['tests/holdout3/metaphors.json', 'tests/holdout2/metaphors.json']
  .flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')));
let s = 42;
const pickRandom = [...cases].sort(() => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5).slice(0, N);

const call = (text: string) => new Promise<string>(resolve => {
  const res = { code: 200, status(c: number) { this.code = c; return this; }, json(b: any) { resolve(this.code === 200 ? (b.picks ?? []).map((p: any) => p.id + (p.variant === 'bg' ? '(bg)' : '')).sort().join(',') : `HTTP ${this.code}`); } };
  handler({ method: 'POST', headers: { 'x-forwarded-for': `stab-${Math.random()}` }, body: { text } }, res);
});

const rows: string[] = [];
let unstableObjects = 0, unstableAny = 0;
for (const c of pickRandom) {
  const answers: string[] = [];
  for (let i = 0; i < R; i++) answers.push(await call(c.text));
  const objects = new Set(answers.map(a => a.replace(/\(bg\)/g, '').split(',').sort().join(',')));
  if (new Set(answers).size > 1) unstableAny++;
  if (objects.size > 1) { unstableObjects++; rows.push(`| ${c.id} | ${c.text.slice(0, 60)} | ${answers.join(' / ')} |`); }
  process.stdout.write(objects.size > 1 ? 'x' : '.');
}
const prompt = fs.readFileSync('api/pick.ts', 'utf8');
const summary = [
  `- модель: ${process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5'}, отпечаток api/pick.ts: ${crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 12)}, дата: ${new Date().toISOString().slice(0, 16)}`,
  `- фраз: ${N}, повторов: ${R}`,
  `- меняется набор объектов: ${unstableObjects} из ${N}`,
  `- меняется хоть что-то (включая главный/фоновый): ${unstableAny} из ${N}`,
].join('\n');
fs.writeFileSync('tests/report-stability.md', `# Стабильность ответов ИИ\n\n${summary}\n\n| id | фраза | ответы |\n|---|---|---|\n${rows.join('\n')}\n`);
console.log('\n' + summary);
