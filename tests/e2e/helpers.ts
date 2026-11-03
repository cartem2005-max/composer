import { test as base, expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lib = JSON.parse(readFileSync(resolve(process.cwd(), 'src/library.generated.json'), 'utf8'));
export const SCHEMES: Record<string, Record<string, string>> = Object.fromEntries(lib.schemes.map((s: any) => [s.id, s]));
export const OBJECTS: { id: string; name: string }[] = lib.objects.map((o: any) => ({ id: o.id, name: o.name }));
export const NAME_BY_ID: Record<string, string> = Object.fromEntries(OBJECTS.map(o => [o.id, o.name]));
export const ROLES = ['bg1', 'bg2', 'bg3', 'black', 'obj1', 'obj2', 'obj3', 'white'];
export const FORMAT_SIZE = { og: [1200, 630], square: [1080, 1080], vertical: [1080, 1920] } as const;
export const FORMAT_LABEL = { og: '1200 × 630', square: 'Квадрат 1080', vertical: 'Вертикаль 1080 × 1920' } as const;
export const LAYOUT_LABEL = { compact: 'Собранно', offset: 'Со смещением', title: 'Под заголовок' } as const;
export type FormatId = keyof typeof FORMAT_SIZE;
export type LayoutId = keyof typeof LAYOUT_LABEL;

export const DEFAULT_PICK = { picks: [{ id: 'lamp', variant: 'main' }, { id: 'book', variant: 'bg' }], reason: 'тест' };

export interface Ctx {
  /** Сообщения console.error и необработанные исключения страницы. */
  errors: string[];
  /** Сколько запросов к /api/pick поймал мок (настоящий запрос к API не уходит никогда). */
  pickCalls: { count: number; bodies: string[] };
  /** Заменить поведение мока /api/pick. */
  mockPick(handler: (route: Route) => Promise<void> | void): Promise<void>;
}

/** test с общими настройками: мок /api/pick, сбор ошибок консоли, чистое localStorage. */
export const test = base.extend<{ ctx: Ctx; app: Page }>({
  ctx: async ({ page }, use) => {
    const errors: string[] = [];
    const pickCalls = { count: 0, bodies: [] as string[] };
    page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    let handler: (route: Route) => Promise<void> | void = route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEFAULT_PICK) });
    // Единственный способ добраться до API — через этот обработчик. Без него запрос ушёл бы на dev-сервер.
    await page.route('**/api/pick', async route => {
      pickCalls.count++;
      pickCalls.bodies.push(route.request().postData() ?? '');
      await handler(route);
    });
    await use({ errors, pickCalls, mockPick: async h => { handler = h; } });
  },
  // app — страница, уже открытая на чистом состоянии (localStorage пуст, холст очищен не всегда).
  app: async ({ page, ctx }, use) => {
    void ctx;
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator('#canvas svg').waitFor();
    await use(page);
  },
});
export { expect };

// ---------- чтение состояния из DOM ----------

export interface Item {
  uid: number;
  id: string;
  objectId: string;
  variant: 'main' | 'bg';
  x: number;
  y: number;
  rotation: number;
  scale: number;
  transform: string;
  name: string;
  /** Индекс в порядке слоёв (0 — нижний). */
  index: number;
}

export async function items(page: Page): Promise<Item[]> {
  return page.evaluate(() => {
    return [...document.querySelectorAll('#canvas svg [data-uid]')].map((g, index) => {
      const t = g.getAttribute('transform') ?? '';
      const tr = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(t);
      const rot = /rotate\(([-\d.e]+)\)/.exec(t);
      const sc = /scale\(([-\d.e]+)\)/.exec(t);
      const id = g.getAttribute('id') ?? '';
      const m = /^([a-z]+)-(main|bg)-\d+$/.exec(id);
      return {
        uid: Number(g.getAttribute('data-uid')), id, objectId: m?.[1] ?? '', variant: (m?.[2] ?? 'main') as 'main' | 'bg',
        x: tr ? Number(tr[1]) : NaN, y: tr ? Number(tr[2]) : NaN, rotation: rot ? Number(rot[1]) : 0,
        scale: sc ? Number(sc[1]) : NaN, transform: t, name: g.getAttribute('data-name') ?? '', index,
      };
    });
  });
}

export async function ids(page: Page): Promise<string[]> {
  return (await items(page)).map(i => i.id);
}

/** id выделенного объекта из заголовка панели «Объект» или null. */
export async function selectedId(page: Page): Promise<string | null> {
  const t = page.locator('#object-panel .obj-title span');
  if ((await t.count()) === 0) return null;
  return (await t.first().textContent())?.trim() ?? null;
}

export async function selectionCount(page: Page) { return page.locator('#selection').count(); }

export async function noticeText(page: Page) {
  const n = page.locator('#notice');
  return (await n.isVisible()) ? ((await n.textContent()) ?? '') : '';
}

export async function pressedLabels(page: Page, container: string): Promise<string[]> {
  return page.locator(`${container} button[aria-pressed=true]`).allTextContents();
}

export async function currentFormat(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const vb = document.querySelector('#canvas svg')!.getAttribute('viewBox')!.split(' ').map(Number);
    return [vb[2], vb[3]] as [number, number];
  });
}

export async function savedComposition(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('ochen.composition') ?? 'null'));
}

// ---------- действия ----------

export async function clearAll(page: Page) {
  await page.locator('#btn-clear').click();
  await expect(page.locator('#canvas svg [data-uid]')).toHaveCount(0);
}

export async function addObject(page: Page, name: string, opts: { bg?: boolean } = {}) {
  const before = (await items(page)).length;
  await page.locator('#library .lib-item', { hasText: new RegExp(`^${name}$`) }).click({ modifiers: opts.bg ? ['Shift'] : [] });
  await expect(page.locator('#canvas svg [data-uid]')).toHaveCount(before + 1);
}

export async function addById(page: Page, id: string, opts: { bg?: boolean } = {}) {
  await addObject(page, NAME_BY_ID[id], opts);
}

export const panelBtn = (page: Page, a: string) => page.locator(`#object-panel [data-a=${a}]`);
export const segBtn = (page: Page, container: string, text: string | RegExp) =>
  page.locator(`${container} button`, { hasText: text });

export async function setFormat(page: Page, f: FormatId) { await segBtn(page, '#seg-format', FORMAT_LABEL[f]).click(); }
export async function setLayout(page: Page, l: LayoutId) { await segBtn(page, '#seg-layout', LAYOUT_LABEL[l]).click(); }
export async function setScheme(page: Page, name: string) { await page.locator('#schemes .scheme', { hasText: name }).click(); }

/** Подбор по названиям (словарь, без сети). */
export async function submitNames(page: Page, text: string) {
  await page.locator('#in-names').fill(text);
  await page.locator('#form-names button[type=submit]').click();
}

/**
 * Точка в экранных координатах, где клик гарантированно попадёт в видимую часть объекта uid
 * (а не в другой объект и не в пустое место). null — объект не виден / перекрыт полностью.
 */
export async function hitPoint(page: Page, uid: number): Promise<{ x: number; y: number } | null> {
  return page.evaluate((uid) => {
    const g = document.querySelector(`#canvas svg [data-uid="${uid}"]`);
    if (!g) return null;
    const r = g.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    const pts: { x: number; y: number; d: number }[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = r.x + (r.width * i) / N, y = r.y + (r.height * j) / N;
      if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
      pts.push({ x, y, d: Math.hypot(x - cx, y - cy) });
    }
    pts.sort((a, b) => a.d - b.d);
    for (const p of pts) {
      const el = document.elementFromPoint(p.x, p.y);
      if (el && el.closest('[data-uid]') === g) return { x: p.x, y: p.y };
    }
    return null;
  }, uid);
}

export async function clickItem(page: Page, uid: number) {
  await page.locator(`#canvas svg [data-uid="${uid}"]`).scrollIntoViewIfNeeded();
  const p = await hitPoint(page, uid);
  if (!p) throw new Error(`Объект ${uid} не удалось найти под курсором`);
  await page.mouse.click(p.x, p.y);
}

/** Перетащить объект на (dx, dy) экранных пикселей, начав жест в точке hit. */
export async function dragItem(page: Page, uid: number, dx: number, dy: number, steps = 8) {
  const p = await hitPoint(page, uid);
  if (!p) throw new Error(`Объект ${uid} не удалось найти под курсором`);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps });
  await page.mouse.up();
  return p;
}

/** Пустое место холста (вне объектов) — край svg. */
export async function clickEmptyCanvas(page: Page) {
  const box = (await page.locator('#canvas svg').boundingBox())!;
  await page.mouse.click(box.x + 3, box.y + 3);
}

// ---------- экспорт и проверка SVG ----------

export async function exportSvg(page: Page): Promise<{ text: string; filename: string }> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export').click()]);
  const stream = await dl.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk.toString('utf8');
  return { text, filename: dl.suggestedFilename() };
}

export interface SvgReport {
  parseError: string | null;
  width: string | null; height: string | null; viewBox: string | null;
  hasImage: boolean; hasScript: boolean; hasForeign: boolean; hasHref: boolean;
  groupIds: string[]; uids: string[];
  clipId: string | null; clipPathUses: string[]; urlRefs: string[];
  bgFill: string | null;
  colors: string[];
  groupTransforms: Record<string, string>;
}

export async function analyzeSvg(page: Page, text: string): Promise<SvgReport> {
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    const root = doc.documentElement;
    const groups = [...doc.querySelectorAll('g[data-uid]')];
    const colors = [...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
    const groupTransforms: Record<string, string> = {};
    groups.forEach(g => { groupTransforms[g.getAttribute('id')!] = g.getAttribute('transform') ?? ''; });
    return {
      parseError: err ? (err.textContent ?? 'parsererror').slice(0, 200) : null,
      width: root.getAttribute('width'), height: root.getAttribute('height'), viewBox: root.getAttribute('viewBox'),
      hasImage: !!doc.querySelector('image') || /<image\b/i.test(text),
      hasScript: !!doc.querySelector('script') || /<script\b/i.test(text),
      hasForeign: !!doc.querySelector('foreignObject'),
      hasHref: /\b(xlink:)?href\s*=/i.test(text),
      groupIds: groups.map(g => g.getAttribute('id')!),
      uids: groups.map(g => g.getAttribute('data-uid')!),
      clipId: doc.querySelector('clipPath')?.getAttribute('id') ?? null,
      clipPathUses: [...doc.querySelectorAll('[clip-path]')].map(e => e.getAttribute('clip-path')!),
      urlRefs: [...text.matchAll(/url\(([^)]*)\)/g)].map(m => m[1]),
      bgFill: doc.querySelector('#background')?.getAttribute('fill') ?? null,
      colors, groupTransforms,
    };
  }, text);
}

/**
 * Полная проверка экспортированного SVG: разбирается, без растров/скриптов/ссылок, id уникальны и по шаблону,
 * в файле только цвета схемы. Возвращает отчёт для дополнительных проверок.
 */
export async function validateExport(page: Page, text: string, opts: { scheme?: Record<string, string>; fmt?: readonly [number, number]; count?: number; uniqueUids?: boolean } = {}) {
  const r = await analyzeSvg(page, text);
  expect(r.parseError, 'SVG должен разбираться как XML').toBeNull();
  expect(text.startsWith('<?xml')).toBeTruthy();
  expect(r.hasImage, 'в SVG нет <image>').toBeFalsy();
  expect(r.hasScript, 'в SVG нет <script>').toBeFalsy();
  expect(r.hasForeign).toBeFalsy();
  expect(r.hasHref, 'в SVG нет href/xlink').toBeFalsy();
  const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(' xmlns="http://www.w3.org/2000/svg"', '');
  expect(body).not.toMatch(/data:|https?:|javascript:|\bon\w+\s*=/i);
  expect(new Set(r.groupIds).size, 'id групп уникальны').toBe(r.groupIds.length);
  if (opts.uniqueUids !== false) expect(new Set(r.uids).size, 'data-uid уникальны').toBe(r.uids.length);
  for (const id of r.groupIds) expect(id).toMatch(/^(book|phone|puzzle|coin|headphones|lamp|tulips|wallet|folder|pen)-(main|bg)-\d+$/);
  // Единственная url(#…) — clipPath кадра.
  expect(r.urlRefs.every(u => u === `#${r.clipId}`), `внутренние ссылки: ${r.urlRefs.join(',')}`).toBeTruthy();
  expect(text).not.toMatch(/NaN|undefined|Infinity/);
  if (opts.fmt) {
    expect(r.width).toBe(String(opts.fmt[0])); expect(r.height).toBe(String(opts.fmt[1]));
    expect(r.viewBox).toBe(`0 0 ${opts.fmt[0]} ${opts.fmt[1]}`);
    expect(r.clipId).toBe(`frame-${opts.fmt[0]}x${opts.fmt[1]}`);
  }
  if (opts.count !== undefined) expect(r.groupIds.length).toBe(opts.count);
  if (opts.scheme) {
    expect(r.colors.length, 'в файле есть цвета (проверка не пустая)').toBeGreaterThan(0);
    const allowed = new Set(ROLES.map(k => opts.scheme![k].toUpperCase()));
    const bad = r.colors.filter(c => !allowed.has(c.toUpperCase()));
    expect(bad, `цвета не из схемы: ${bad.join(',')}`).toEqual([]);
  }
  return r;
}

/** Цвета схемы по отображаемому имени из панели (читаем HEX из чипов кнопки схемы). */
export async function schemeByName(page: Page, name: string): Promise<Record<string, string>> {
  const chips = await page.locator('#schemes .scheme', { hasText: name }).first().locator('.chips i').evaluateAll(
    els => els.map(e => getComputedStyle(e).backgroundColor));
  const hex = (c: string) => '#' + (c.match(/\d+/g) ?? []).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  const [bg1, bg2, bg3, obj1, obj2, obj3] = chips.map(hex);
  return { bg1, bg2, bg3, obj1, obj2, obj3 };
}

/** Никаких ошибок консоли/страницы. */
export function expectNoErrors(ctx: Ctx) {
  expect(ctx.errors, ctx.errors.join('\n')).toEqual([]);
}

// ---------- ГПСЧ для стабильности ----------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Счётчик кнопки «Другие цвета (n/N)». null — кнопки нет (у объекта один оттенок, кнопка скрыта). */
export async function toneInfo(page: Page): Promise<{ n: number; total: number } | null> {
  const b = page.locator('#object-panel [data-a=tone]');
  if ((await b.count()) === 0) return null;
  const m = /\((\d+)\/(\d+)\)/.exec((await b.first().textContent()) ?? '');
  return m ? { n: Number(m[1]), total: Number(m[2]) } : null;
}
