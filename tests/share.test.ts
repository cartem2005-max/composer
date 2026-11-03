// Ссылка «Поделиться» и восстановление композиции из внешних данных.

import { describe, expect, it } from 'vitest';
import { compositionFromLink, sanitizeComposition, shareLink } from '../src/share';
import { library } from '../src/library';
import type { Composition } from '../src/types';

(globalThis as any).location = { origin: 'https://example.test', pathname: '/' };

const base: Composition = {
  format: 'square', layout: 'offset', size: 'S', schemeId: 'teal', background: 'bg2', scale: 0.4321, decor: false, seed: 3,
  items: [
    { uid: 1, objectId: 'tulips', variant: 'bg', tone: 1, x: 300.25, y: 400.5, rotation: 15 },
    { uid: 2, objectId: 'book', variant: 'main', tone: 4, x: 600, y: 700, rotation: 0 },
  ],
};

describe('ссылка «Поделиться»', () => {
  it('композиция переживает кодирование в ссылку без потерь', () => {
    const back = compositionFromLink(new URL(shareLink(base)).hash)!;
    expect(back.format).toBe('square');
    expect(back.layout).toBe('offset');
    expect(back.size).toBe('S');
    expect(back.schemeId).toBe('teal');
    expect(back.decor).toBe(false);
    expect(back.seed).toBe(3);
    expect(back.items.map(i => [i.objectId, i.variant, i.tone, i.rotation])).toEqual([['tulips', 'bg', 1, 15], ['book', 'main', 4, 0]]);
    expect(Math.abs(back.items[0].x - 300.25)).toBeLessThan(0.1);
  });

  it('мусор, чужие объекты и огромные числа не проходят', () => {
    for (const h of ['', '#', '#c=', '#c=%%%', '#c=' + 'A'.repeat(30000), '#x=abc'])
      expect(compositionFromLink(h)).toBeNull();
    const evil = sanitizeComposition({
      format: 'huge', layout: 'x', schemeId: '<script>', background: 'obj1', scale: 1e9,
      items: [{ objectId: 'rocket' }, { objectId: '__proto__' }, { objectId: 'book', x: 1e12, y: -5, tone: 99, rotation: NaN, variant: 'evil' },
        ...Array(100).fill({ objectId: 'pen' })],
    })!;
    expect(evil.format).toBe('og');
    expect(evil.schemeId).toBe(library.schemes[0].id);
    expect(evil.background).toBe('bg1');
    expect(evil.scale).toBeLessThanOrEqual(3);
    expect(evil.items.length).toBeLessThanOrEqual(40);
    expect(evil.items[0]).toMatchObject({ objectId: 'book', variant: 'main', x: 1200, y: 0, rotation: 0 });
    expect(evil.items.every(i => i.objectId !== ('rocket' as any))).toBe(true);
  });
});
