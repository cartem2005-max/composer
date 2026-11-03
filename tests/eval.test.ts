// Прогон тестовых фраз (как набор диалогов для ботов): метафоры, списки компонентов, атаки.
// Здесь проверяется запасной словарь — он работает всегда, даже без ключа ИИ.
// Прогон через ИИ — scripts/eval-ai.mjs (нужен ключ, платно, запускается вручную).

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickByDictionary, pickByNames } from '../src/match/pick';
import { OBJECT_IDS } from '../src/library';
import { parsePalette } from '../src/schemes';
import type { Pick } from '../src/types';

interface Case { id: string; text: string; must?: string[][]; allowed?: string[]; expect?: Pick[]; kind: string; generate?: boolean; note?: string }

const load = (file: string): Case[] => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
const expand = (c: Case) => {
  if (!c.generate) return c.text;
  const m = /^repeat:(.*):(\d+)$/s.exec(c.text);
  return m ? m[1].repeat(Math.ceil(Number(m[2]) / Math.max(1, m[1].length))).slice(0, Number(m[2])) : c.text;
};
const cases = [
  ...load('tests/metaphors.json'), ...load('tests/gpt/metaphors.json'), ...load('tests/gpt/attacks.json'), ...load('tests/gpt/names.json'),
  ...load('tests/claude/metaphors.json'), ...load('tests/claude/attacks.json'), ...load('tests/claude/names.json'),
  ...load('tests/holdout1/metaphors.json'), ...load('tests/holdout1/attacks.json'), ...load('tests/holdout1/names.json'),
  ...load('tests/holdout2/metaphors.json'), ...load('tests/holdout2/attacks.json'), ...load('tests/holdout2/names.json'),
  ...load('tests/holdout3/metaphors.json'), ...load('tests/holdout3/attacks.json'),
];

function check(c: Case, picks: Pick[]) {
  const ids = picks.map(p => p.id as string);
  const outside = ids.filter(id => !OBJECT_IDS.includes(id as any));
  const notAllowed = c.allowed ? ids.filter(id => !c.allowed!.includes(id)) : [];
  const missing = (c.must ?? []).filter(group => !group.some(id => ids.includes(id)));
  return { ok: !outside.length && !notAllowed.length && !missing.length, outside, notAllowed, missing };
}

describe('прогон фраз через словарь', () => {
  const rows: string[] = [];
  const stats: Record<string, { total: number; ok: number }> = {};

  it('ни одна фраза не роняет сервис и не выводит за пределы библиотеки', () => {
    for (const c of cases) {
      const text = expand(c);
      const r = c.kind === 'names' ? pickByNames(text) : pickByDictionary(text);
      const res = check(c, r.picks);
      expect(res.outside, c.id).toEqual([]);
      expect(r.picks.length).toBeLessThanOrEqual(5);
      const s = (stats[c.kind] ??= { total: 0, ok: 0 });
      s.total++;
      let ok = res.ok;
      if (c.kind === 'names' && c.expect) ok = JSON.stringify(r.picks) === JSON.stringify(c.expect);
      if (ok) s.ok++;
      else rows.push(`| ${c.id} | ${c.kind} | ${text.slice(0, 60).replace(/\|/g, '/')} | ${r.picks.map(p => p.id + (p.variant === 'bg' ? '(bg)' : '')).join(', ') || '—'} | ${res.missing.map(g => g.join('/')).join('; ') || (c.expect ? 'ожидалось ' + c.expect.map(p => p.id + (p.variant === 'bg' ? '(bg)' : '')).join(', ') : '')} ${res.notAllowed.length ? 'лишние: ' + res.notAllowed.join(', ') : ''} |`);
    }
    const summary = Object.entries(stats).map(([k, s]) => `- ${k}: ${s.ok} из ${s.total} (${Math.round((s.ok / s.total) * 100)}%)`).join('\n');
    fs.writeFileSync('tests/report-dictionary.md',
      `# Прогон фраз через запасной словарь\n\nВыход за пределы библиотеки: 0 (иначе тест падает).\n\n${summary}\n\n## Не совпало с эталоном\n\n| id | тип | фраза | выбрано | чего не хватило |\n|---|---|---|---|---|\n${rows.join('\n')}\n`);
    console.log(summary);
  });
});

describe('прогон палитр', () => {
  const palettes: { id: string; input: string; expect: 'ok' | 'error' }[] = load('tests/gpt/palettes.json') as any;
  it('каждая палитра принимается или отклоняется по эталону, без исключений', () => {
    const wrong: string[] = [];
    for (const p of palettes) {
      const input = expand({ id: p.id, text: p.input, kind: 'palette', generate: /^repeat:/.test(p.input) });
      const res = parsePalette(input, 'Тест');
      if ((res.scheme ? 'ok' : 'error') !== p.expect) wrong.push(`${p.id}: ждали ${p.expect}, получили ${res.error ?? 'ok'}`);
    }
    expect(wrong).toEqual([]);
  });
});
