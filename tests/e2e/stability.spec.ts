import {
  test, expect, items, hitPoint, mulberry32, exportSvg, validateExport, OBJECTS, NAME_BY_ID, ROLES, type Ctx,
} from './helpers';
import type { Page } from '@playwright/test';

/**
 * Стабильность: N случайных действий пользователя (клики по библиотеке, объектам, кнопкам панели, горячие клавиши,
 * форматы, схемы, палитры, подбор). Генератор случайных чисел с seed: тот же seed — тот же сценарий.
 * После каждых 10 действий проверяются инварианты холста и панелей; в конце — экспорт.
 *
 * Известный баг дублирования uid (objects.spec.ts, «БАГ uid») здесь обходится: после «Собрать» страница перезагружается,
 * тогда uid нумеруются заново. Иначе это один и тот же баг ловился бы в каждом прогоне.
 */

const KEYS = ['r', 'Shift+R', '[', ']', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowDown',
  'Delete', 'Backspace', 'Control+d', 'Escape', 'Control+z', 'Control+Shift+z', 'Control+y', 'Meta+z'];
const PANEL = ['variant', 'tone', 'front', 'back', 'top', 'bottom', 'dup', 'del'];
const NAME_LISTS = ['книга, лампа', 'монета, кошелёк, фоновая папка', 'ручка + наушники и телефон', 'пазл, тюльпаны, книга, лампа, монета', 'дракон', 'книга (фон), лампа (фон)'];
const PALETTES = [
  '#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF',
  '{"name":"Фуз","bg":["#101010","#202020","#303030"],"obj":["#ff00ff","#00ffff","#ffff00"]}',
  '#EEEEEE #CCCCCC', '{"bg":1}', '<b>x</b>', '#112233 #223344 #334455 #445566 #556677 #667788',
];
const METAPHORS = ['Как накопить на отпуск', 'идея', '<i>тест</i>', 'a'.repeat(250)];

async function activeSchemeColors(page: Page) {
  const hex = (c: string) => '#' + (c.match(/\d+/g) ?? []).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  const chips = await page.locator('#schemes .scheme[aria-pressed=true] .chips i').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor));
  const [bg1, bg2, bg3, obj1, obj2, obj3] = chips.map(hex);
  return { bg1, bg2, bg3, obj1, obj2, obj3, black: '#181817', white: '#FFFFFF' };
}

async function invariants(page: Page, step: number): Promise<string[]> {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const svgs = document.querySelectorAll('#canvas svg');
    if (svgs.length !== 1) { out.push(`svg на холсте: ${svgs.length}`); return out; }
    const svg = svgs[0];
    const html = svg.outerHTML;
    if (/NaN|undefined|Infinity/.test(html)) out.push('в SVG холста NaN/undefined/Infinity');
    const vb = svg.getAttribute('viewBox');
    if (!['0 0 1200 630', '0 0 1080 1080', '0 0 1080 1920'].includes(vb ?? '')) out.push(`viewBox ${vb}`);
    const gs = [...svg.querySelectorAll('[data-uid]')];
    const uids = gs.map(g => g.getAttribute('data-uid'));
    const ids = gs.map(g => g.getAttribute('id'));
    if (new Set(uids).size !== uids.length) out.push(`дубли data-uid: ${uids.join(',')}`);
    if (new Set(ids).size !== ids.length) out.push(`дубли id: ${ids.join(',')}`);
    for (const id of ids) if (!/^[a-z]+-(main|bg)-\d+$/.test(id ?? '')) out.push(`странный id ${id}`);
    for (const g of gs) {
      const nums = (g.getAttribute('transform') ?? '').match(/-?[\d.]+(e-?\d+)?/g) ?? [];
      if (nums.some(n => !Number.isFinite(Number(n)))) out.push(`transform ${g.getAttribute('transform')}`);
    }
    const sel = svg.querySelectorAll('#selection').length;
    if (sel > 1) out.push(`рамок выделения: ${sel}`);
    const title = document.querySelector('#object-panel .obj-title span')?.textContent?.trim() ?? null;
    if ((sel === 1) !== (title !== null)) out.push(`выделение (${sel}) и панель объекта (${title}) не согласованы`);
    if (title && !ids.includes(title)) out.push(`панель показывает ${title}, на холсте его нет`);
    for (const [cont, label] of [['#seg-format', 'формат'], ['#seg-layout', 'раскладка'], ['#seg-size', 'размер'], ['#seg-bg', 'фон'], ['#schemes', 'схема']] as const) {
      const n = document.querySelectorAll(`${cont} [aria-pressed=true]`).length;
      if (n !== 1) out.push(`${label}: нажатых кнопок ${n}`);
    }
    try {
      const saved = JSON.parse(localStorage.getItem('ochen.composition') ?? 'null');
      if (!saved || saved.items.length !== gs.length) out.push(`сохранено объектов ${saved?.items?.length}, на холсте ${gs.length}`);
    } catch { out.push('localStorage не читается'); }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 && innerWidth > 900) out.push('горизонтальная прокрутка на десктопе');
    return out;
  });
  return problems.map(p => `шаг ${step}: ${p}`);
}

async function runFuzz(page: Page, ctx: Ctx, seed: number, steps: number) {
  const rnd = mulberry32(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <T,>(a: T[]) => a[int(a.length)];
  const log: string[] = [];
  const failures: string[] = [];
  const dialogs: string[] = [];
  page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });

  const count = () => page.locator('#canvas svg [data-uid]').count();
  const hasPanel = async () => (await page.locator('#object-panel [data-a=del]').count()) > 0;

  const actions: { w: number; name: string; run: () => Promise<void> }[] = [
    { w: 10, name: 'библиотека', run: async () => {
      if ((await count()) >= 35) return;
      const o = pick(OBJECTS);
      const bg = rnd() < 0.25;
      log.push(`  ${o.id}${bg ? ' (shift)' : ''}`);
      await page.locator('#library .lib-item', { hasText: new RegExp(`^${NAME_BY_ID[o.id]}$`) }).click({ modifiers: bg ? ['Shift'] : [] });
    } },
    { w: 8, name: 'клик по объекту', run: async () => {
      const list = await items(page); if (!list.length) return;
      const it = pick(list);
      await page.locator(`#canvas svg [data-uid="${it.uid}"]`).scrollIntoViewIfNeeded();
      const p = await hitPoint(page, it.uid); if (!p) { log.push('  (перекрыт — пропуск)'); return; }
      log.push(`  ${it.id}`);
      await page.mouse.click(p.x, p.y);
    } },
    { w: 6, name: 'перетаскивание', run: async () => {
      const list = await items(page); if (!list.length) return;
      const it = pick(list);
      await page.locator(`#canvas svg [data-uid="${it.uid}"]`).scrollIntoViewIfNeeded();
      const p = await hitPoint(page, it.uid); if (!p) return;
      const far = rnd() < 0.12;
      const dx = (rnd() - 0.5) * (far ? 5000 : 500), dy = (rnd() - 0.5) * (far ? 5000 : 400);
      log.push(`  ${it.id} на ${Math.round(dx)},${Math.round(dy)}`);
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + dx, p.y + dy, { steps: 4 });
      await page.mouse.up();
    } },
    ...PANEL.map(a => ({ w: a === 'del' ? 2 : 3, name: `панель:${a}`, run: async () => {
      if (!(await hasPanel())) return;
      if (a === 'dup' && (await count()) >= 35) return;
      await page.locator(`#object-panel [data-a=${a}]`).click();
    } })),
    { w: 3, name: 'ползунок поворота', run: async () => {
      if (!(await hasPanel())) return;
      const v = String(int(360)); log.push('  ' + v);
      await page.locator('#object-panel [data-a=rot]').fill(v);
    } },
    { w: 14, name: 'клавиша', run: async () => {
      const k = pick(KEYS); log.push('  ' + k);
      await page.keyboard.press(k);
    } },
    ...(['#seg-format', '#seg-layout', '#seg-size', '#seg-bg'] as const).map(c => ({ w: 2, name: `сегмент ${c}`, run: async () => {
      const btns = page.locator(`${c} button`); const n = await btns.count();
      const i = int(n); log.push('  ' + i);
      await btns.nth(i).click();
    } })),
    { w: 2, name: 'схема', run: async () => {
      const b = page.locator('#schemes .scheme'); const i = int(await b.count()); log.push('  ' + i);
      await b.nth(i).click();
    } },
    { w: 2, name: 'масштаб', run: async () => {
      const v = String(Number((0.1 + rnd() * 1.9).toFixed(2))); log.push('  ' + v);
      await page.locator('#in-scale').fill(v);
    } },
    { w: 3, name: 'отменить', run: async () => { const b = page.locator('#btn-undo'); if (await b.isEnabled()) await b.click(); } },
    { w: 2, name: 'вернуть', run: async () => { const b = page.locator('#btn-redo'); if (await b.isEnabled()) await b.click(); } },
    { w: 1, name: 'очистить', run: async () => { await page.locator('#btn-clear').click(); } },
    { w: 2, name: 'другой вариант', run: async () => { await page.locator('#btn-variant').click(); } },
    { w: 1, name: 'декор', run: async () => { await page.locator('#in-decor').click(); } },
    { w: 1, name: 'подбор по названиям', run: async () => {
      const t = pick(NAME_LISTS); log.push('  ' + t);
      await page.locator('#in-names').fill(t);
      await page.locator('#form-names button[type=submit]').click();
      await page.reload(); // обход бага uid
    } },
    { w: 1, name: 'подбор по метафоре (мок)', run: async () => {
      const mode = pick(['ok', 'ok', '500', 'abort', 'garbage']); const t = pick(METAPHORS); log.push(`  ${mode}: ${t.slice(0, 20)}`);
      await ctx.mockPick(route => mode === 'abort' ? route.abort('failed')
        : mode === '500' ? route.fulfill({ status: 500, body: 'x' })
        : mode === 'garbage' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"picks":[{"id":"zzz"}]}' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ picks: [{ id: 'pen', variant: 'main' }, { id: 'folder', variant: 'main' }, { id: 'coin', variant: 'bg' }], reason: 'фуз' }) }));
      await page.locator('#in-metaphor').fill(t);
      await page.locator('#form-metaphor button[type=submit]').click();
      await expect(page.locator('#form-metaphor button[type=submit]')).toHaveText('Собрать');
      await page.reload();
    } },
    { w: 1, name: 'палитра', run: async () => {
      const t = pick(PALETTES); log.push('  ' + t.slice(0, 30));
      const d = page.locator('details', { has: page.locator('#in-palette') });
      if (!(await d.evaluate(e => (e as HTMLDetailsElement).open))) await page.locator('summary', { hasText: 'Загрузить палитру' }).click();
      await page.locator('#in-palette').fill(t);
      await page.locator('#btn-palette').click();
    } },
    { w: 1, name: 'скачать SVG', run: async () => {
      const { text } = await exportSvg(page);
      const bad = await page.evaluate(t => !!new DOMParser().parseFromString(t, 'image/svg+xml').querySelector('parsererror'), text);
      if (bad) failures.push('экспортированный SVG не разбирается');
    } },
    { w: 1, name: 'zip всех форматов', run: async () => {
      if (!(await count())) return;
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), page.locator('#btn-formats').click()]);
      const chunks: Buffer[] = []; for await (const c of await dl.createReadStream()) chunks.push(Buffer.from(c));
      if (Buffer.concat(chunks).subarray(0, 2).toString() !== 'PK') failures.push('архив форматов не zip');
    } },
    { w: 1, name: 'поделиться', run: async () => { await page.locator('#btn-share').click(); } },
  ];
  const total = actions.reduce((s, a) => s + a.w, 0);
  const choose = () => { let r = rnd() * total; for (const a of actions) { r -= a.w; if (r < 0) return a; } return actions[0]; };

  await page.locator('#canvas svg').waitFor();
  for (let step = 1; step <= steps; step++) {
    const a = choose();
    log.push(`${step}. ${a.name}`);
    try { await a.run(); } catch (e) {
      failures.push(`шаг ${step} «${a.name}» упал: ${(e as Error).message.split('\n')[0]}`);
      break;
    }
    if (step % 10 === 0 || step === steps) failures.push(...(await invariants(page, step)));
    if (failures.length) break;
  }

  if (!failures.length) {
    const { text } = await exportSvg(page);
    const scheme = await activeSchemeColors(page);
    try { await validateExport(page, text, { scheme: Object.fromEntries(ROLES.map(r => [r, (scheme as any)[r]])) }); }
    catch (e) { failures.push('итоговый экспорт: ' + (e as Error).message.split('\n').slice(0, 3).join(' | ')); }
  }
  const appErrors = ctx.errors.filter(e => !/Failed to load resource/.test(e));
  const report = [...failures, ...appErrors, ...dialogs.map(d => 'dialog: ' + d)];
  expect(report, `Сценарий seed=${seed}. Последние действия:\n${log.slice(-25).join('\n')}`).toEqual([]);
}

test.describe('Стабильность: случайные действия', () => {
  test('300 случайных действий (seed 20261103), десктоп', async ({ app: page, ctx }) => {
    test.setTimeout(300_000);
    await runFuzz(page, ctx, 20261103, 300);
  });

  test('300 случайных действий (seed 7), десктоп', async ({ app: page, ctx }) => {
    test.setTimeout(300_000);
    await runFuzz(page, ctx, 7, 300);
  });

  test.describe('мобильный viewport', () => {
    test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    test('300 случайных действий (seed 42), 375×812', async ({ app: page, ctx }) => {
      test.setTimeout(300_000);
      await runFuzz(page, ctx, 42, 300);
    });
  });
});
