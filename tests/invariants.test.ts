// Проверка правил задания на тысячах случайных композиций.
// Нельзя: менять пропорции объектов друг относительно друга, менять сам объект, нарушать цветовую схему.

import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { library, OBJECT_IDS, toneCount } from '../src/library';
import { autoLayout } from '../src/layout';
import { compositionSvg, FORMATS } from '../src/render';
import { sanitizePicks } from '../src/match/catalog';
import { parsePalette } from '../src/schemes';
import { BG_ROLES, OBJ_ROLES, type Composition, type FormatId, type LayoutId, type Pick, type Scheme } from '../src/types';

// Детерминированный генератор, чтобы падение можно было воспроизвести.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const pickOne = <T,>(r: () => number, arr: readonly T[]) => arr[Math.floor(r() * arr.length)];

const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];
const LAYOUT_IDS: LayoutId[] = ['compact', 'offset', 'title'];
const sourceD = (size: string) => new Set(
  [...fs.readFileSync(`figma-svg/size-${size}.svg`, 'utf8').matchAll(/\sd="([^"]*)"/g)].map(m => m[1]));
const SOURCE = { L: sourceD('L'), S: sourceD('S') };

function randomComposition(r: () => number): Composition {
  const n = 1 + Math.floor(r() * 7);
  const scheme = pickOne(r, library.schemes);
  return {
    format: pickOne(r, FORMAT_IDS),
    layout: pickOne(r, LAYOUT_IDS),
    size: r() < 0.5 ? 'L' : 'S',
    schemeId: scheme.id,
    background: pickOne(r, BG_ROLES),
    scale: 0.1 + r() * 1.5,
    items: Array.from({ length: n }, (_, i) => {
      const variant = r() < 0.6 ? 'main' as const : 'bg' as const;
      return {
        uid: i + 1, objectId: pickOne(r, OBJECT_IDS), variant, tone: Math.floor(r() * toneCount(variant)),
        x: r() * 1400 - 100, y: r() * 2000 - 100, rotation: Math.floor(r() * 360),
      };
    }),
  };
}

const colorsOf = (xml: string) => [...xml.matchAll(/\s(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map(m => m[1].toUpperCase());
const setOf = (s: Scheme, roles: readonly string[]) => new Set(roles.map(r => (s as any)[r].toUpperCase()));

describe('библиотека', () => {
  it('10 объектов, у каждого L и S, главный и фоновый', () => {
    expect(library.objects).toHaveLength(10);
    for (const o of library.objects)
      for (const size of ['L', 'S'] as const)
        for (const v of ['main', 'bg'] as const) expect(o.sizes[size][v].shapes).toBeGreaterThan(5);
  });

  it('геометрия — точные копии фигур из исходных SVG Figma', () => {
    for (const o of library.objects)
      for (const size of ['L', 'S'] as const)
        for (const v of ['main', 'bg'] as const)
          for (const m of o.sizes[size][v].markup.matchAll(/\sd="([^"]*)"/g))
            expect(SOURCE[size].has(m[1]), `${o.id}/${size}/${v}`).toBe(true);
  });

  it('фоновые варианты состоят только из цветов фона', () => {
    for (const o of library.objects)
      for (const size of ['L', 'S'] as const)
        for (const role of o.sizes[size].bg.roles) expect(BG_ROLES as readonly string[]).toContain(role);
  });

  it('L и S одного объекта приведены к одному размеру (разница только в детализации)', () => {
    for (const o of library.objects) {
      const l = o.sizes.L.main.w * library.unitScale.L, s = o.sizes.S.main.w * library.unitScale.S;
      expect(Math.abs(l / s - 1), o.id).toBeLessThan(0.1);
    }
  });
});

describe('2000 случайных композиций', () => {
  const r = rng(42);
  const cases = Array.from({ length: 2000 }, () => randomComposition(r));

  it('SVG корректный, без растров и скриптов', () => {
    for (const c of cases) {
      const svg = compositionSvg(c, { forExport: true });
      const errors: string[] = [];
      const doc = new DOMParser({ onError: (_l, m) => errors.push(m) }).parseFromString(svg, 'image/svg+xml');
      expect(errors).toEqual([]);
      expect(doc.getElementsByTagName('svg')).toHaveLength(1);
      expect(svg).not.toMatch(/<image|<script|data:|href=/i);
    }
  });

  it('все цвета — из выбранной схемы; фон — только цвета фона; фоновые объекты — только цвета фона', () => {
    for (const c of cases) {
      const s = library.schemes.find(x => x.id === c.schemeId)!;
      const allowed = setOf(s, [...BG_ROLES, ...OBJ_ROLES]);
      const svg = compositionSvg(c);
      for (const col of colorsOf(svg)) expect(allowed.has(col)).toBe(true);
      const bgFill = /id="background"[^>]*fill="([^"]+)"/.exec(svg)![1].toUpperCase();
      expect(setOf(s, BG_ROLES).has(bgFill)).toBe(true);
      for (const m of svg.matchAll(/<g id="[a-z]+-bg-\d+"[^>]*>([\s\S]*?)<\/g><\/g>/g))
        for (const col of colorsOf(m[1])) expect(setOf(s, BG_ROLES).has(col)).toBe(true);
    }
  });

  it('у всех объектов один масштаб — пропорции между объектами не меняются', () => {
    for (const c of cases) {
      const scales = [...compositionSvg(c).matchAll(/data-uid="\d+"[^>]*scale\(([\d.e-]+)\)/g)].map(m => Number(m[1]));
      expect(scales).toHaveLength(c.items.length);
      const expected = c.scale * library.unitScale[c.size];
      for (const k of scales) expect(Math.abs(k / expected - 1)).toBeLessThan(1e-3);
    }
  });

  it('геометрия объектов на холсте совпадает с библиотекой', () => {
    for (const c of cases.slice(0, 300)) {
      const svg = compositionSvg(c);
      for (const it of c.items) {
        const libD = [...library.objects.find(o => o.id === it.objectId)!.sizes[c.size][it.variant].markup.matchAll(/\sd="([^"]*)"/g)].map(m => m[1]);
        const g = new RegExp(`data-uid="${it.uid}"[^>]*>([\\s\\S]*?)</g></g>`).exec(svg)![1];
        expect([...g.matchAll(/\sd="([^"]*)"/g)].map(m => m[1])).toEqual(libD);
      }
    }
  });
});

describe('автораскладка', () => {
  const r = rng(7);
  const combos: { picks: Pick[]; format: FormatId; layout: LayoutId; seed: number }[] = [];
  for (let i = 0; i < 600; i++) {
    const n = 1 + Math.floor(r() * 5);
    const picks = sanitizePicks(Array.from({ length: n }, () => ({ id: pickOne(r, OBJECT_IDS), variant: r() < 0.7 ? 'main' : 'bg' })));
    combos.push({ picks, format: pickOne(r, FORMAT_IDS), layout: pickOne(r, LAYOUT_IDS), seed: i % 6 });
  }

  it('каждый выбранный объект попадает на холст, в «Собранно» и «Под заголовок» — целиком в кадре', () => {
    for (const { picks, format, layout, seed } of combos) {
      for (const size of ['L', 'S'] as const) {
        const { scale, items } = autoLayout(picks, format, layout, size, seed);
        expect(items).toHaveLength(picks.length);
        expect(scale).toBeGreaterThan(0);
        const f = FORMATS[format];
        for (const it of items) {
          const o = library.objects.find(x => x.id === it.objectId)!.sizes[size][it.variant];
          const hw = (o.w * library.unitScale[size] * scale) / 2, hh = (o.h * library.unitScale[size] * scale) / 2;
          if (layout !== 'offset') {
            expect(it.x - hw).toBeGreaterThanOrEqual(-0.5);
            expect(it.x + hw).toBeLessThanOrEqual(f.w + 0.5);
            expect(it.y - hh).toBeGreaterThanOrEqual(-0.5);
            expect(it.y + hh).toBeLessThanOrEqual(f.h + 0.5);
          } else {
            expect(it.x).toBeGreaterThan(0); expect(it.x).toBeLessThan(f.w * 1.2);
          }
          if (layout === 'title' && f.h <= f.w * 1.2) expect(it.x - hw).toBeGreaterThanOrEqual(f.w * 0.45);
          if (layout === 'title' && f.h > f.w * 1.2) expect(it.y - hh).toBeGreaterThanOrEqual(f.h * 0.4);
        }
      }
    }
  });
});

describe('размер группы', () => {
  it('«Со смещением»: самый крупный главный объект не меньше половины короткой стороны; «Собранно»: группа заполняет зону', () => {
    const r = rng(21);
    for (let i = 0; i < 300; i++) {
      const n = 1 + Math.floor(r() * 5);
      const picks = sanitizePicks(Array.from({ length: n }, () => ({ id: pickOne(r, OBJECT_IDS), variant: r() < 0.7 ? 'main' : 'bg' })));
      const format = pickOne(r, FORMAT_IDS);
      const f = FORMATS[format], short = Math.min(f.w, f.h);
      const dim = (it: { objectId: string; variant: 'main' | 'bg' }, scale: number) => {
        const o = library.objects.find(x => x.id === it.objectId)!.sizes.L[it.variant];
        return { w: o.w * library.unitScale.L * scale, h: o.h * library.unitScale.L * scale };
      };
      const off = autoLayout(picks, format, 'offset', 'L', i % 6);
      const biggest = Math.max(...off.items.filter(it => it.variant === 'main').map(it => { const d = dim(it, off.scale); return Math.max(d.w, d.h); }));
      expect(biggest / short).toBeGreaterThanOrEqual(0.5);

      const com = autoLayout(picks, format, 'compact', 'L', i % 6);
      const xs = com.items.flatMap(it => { const d = dim(it, com.scale); return [it.x - d.w / 2, it.x + d.w / 2]; });
      const ys = com.items.flatMap(it => { const d = dim(it, com.scale); return [it.y - d.h / 2, it.y + d.h / 2]; });
      const fillX = (Math.max(...xs) - Math.min(...xs)) / (f.w * 0.86), fillY = (Math.max(...ys) - Math.min(...ys)) / (f.h * 0.84);
      const mainMax = Math.max(...com.items.filter(it => it.variant === 'main').map(it => { const d = dim(it, com.scale); return Math.max(d.w, d.h); }));
      // Либо группа упёрлась в зону по одной из осей, либо сработал предел размера одиночного объекта.
      expect(Math.max(fillX, fillY) >= 0.9 || mainMax / short >= 0.8).toBe(true);
    }
  });
});

describe('декор фона', () => {
  it('элементы декора — копии фигур из фрейма «Фон», цвета из схемы', () => {
    for (const size of ['L', 'S'] as const) {
      const d = library.decor[size];
      expect(d.items.length).toBeGreaterThan(2);
      for (const it of d.items) for (const m of it.markup.matchAll(/\sd="([^"]*)"/g)) expect(SOURCE[size].has(m[1])).toBe(true);
    }
    const r = rng(11);
    for (let i = 0; i < 200; i++) {
      const c = { ...randomComposition(r), decor: true };
      const s = library.schemes.find(x => x.id === c.schemeId)!;
      const svg = compositionSvg(c);
      const decor = /<g id="decor">([\s\S]*?)<\/g>\n/.exec(svg)![1];
      for (const col of colorsOf(decor)) expect(setOf(s, [...BG_ROLES, 'white']).has(col)).toBe(true);
    }
  });
});

describe('варианты раскладки', () => {
  it('один и тот же seed даёт одинаковый результат, разные — разный', () => {
    const picks = sanitizePicks([{ id: 'book' }, { id: 'lamp' }, { id: 'pen' }]);
    const a = autoLayout(picks, 'og', 'compact', 'L', 3), b = autoLayout(picks, 'og', 'compact', 'L', 3), c = autoLayout(picks, 'og', 'compact', 'L', 4);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('проверка ответа ИИ', () => {
  it('мусор на входе не роняет и не выводит за пределы библиотеки', () => {
    const r = rng(3);
    const junk = [null, undefined, 42, 'book', {}, [], [null], [{ id: 'rocket' }], [{ id: 'book', variant: 'evil' }],
      Array(100).fill({ id: 'coin' }), [{ id: '__proto__' }], [{ id: 'constructor' }], ['book', 'book', 'pen']];
    for (let i = 0; i < 500; i++)
      junk.push(Array.from({ length: Math.floor(r() * 12) }, () => ({ id: r() < 0.7 ? pickOne(r, OBJECT_IDS) : String(r()), variant: r() < 0.5 ? 'bg' : 'main' })));
    for (const j of junk) {
      const out = sanitizePicks(j);
      expect(out.length).toBeLessThanOrEqual(5);
      expect(out.filter(p => p.variant === 'main').length).toBeLessThanOrEqual(3);
      expect(new Set(out.map(p => p.id)).size).toBe(out.length);
      for (const p of out) expect(OBJECT_IDS).toContain(p.id);
      if (out.length) expect(out.some(p => p.variant === 'main')).toBe(true);
    }
  });
});

describe('загрузка палитры', () => {
  const ok = [
    '#D7CDF5 #AA9BF0 #7864D7 #F9ECB0 #F9A3AA #FFE3E1',
    'd7cdf5, aa9bf0, 7864d7, f9ecb0, f9a3aa, ffe3e1',
    '#111111 #222222 #333333 #444444 #555555 #666666 #000000 #FFFFFF',
    '{"name":"Моя","bg":["#111111","#222222","#333333"],"obj":["#444444","#555555","#666666"]}',
  ];
  const bad = ['', '   ', '#FFF #000', '{"bg":[1,2,3],"obj":[]}', '{broken', '#GGGGGG #111111 #222222 #333333 #444444 #555555',
    '#111111 #222222 #333333 #444444 #555555', 'rgb(1,2,3)', '{"bg":["#111111"],"obj":["#222222"]}', 'x'.repeat(100000)];
  it('правильные палитры принимаются', () => { for (const t of ok) expect(parsePalette(t, 'n').scheme, t).toBeTruthy(); });
  it('неправильные — понятная ошибка, без исключений', () => {
    for (const t of bad) { const res = parsePalette(t, 'n'); expect(res.scheme).toBeUndefined(); expect(res.error).toBeTruthy(); }
  });
});
