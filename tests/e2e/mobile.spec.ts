import {
  test, expect, items, selectedId, clearAll, panelBtn, exportSvg, validateExport, expectNoErrors, setFormat, segBtn, FORMAT_SIZE,
  hitPoint, type FormatId,
} from './helpers';
import type { Page } from '@playwright/test';

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Все видимые кнопки/поля целиком помещаются по ширине окна. */
async function controlsInsideViewport(page: Page) {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad: string[] = [];
    for (const el of document.querySelectorAll('button, input, textarea, summary, #canvas svg')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if ((el as HTMLInputElement).type === 'file') continue; // скрытое поле поверх подписи
      if (r.left < -0.5 || r.right > w + 0.5) bad.push(`${el.tagName}#${el.id}.${(el as HTMLElement).className}|${(el.textContent ?? '').slice(0, 20)} [${Math.round(r.left)}..${Math.round(r.right)}] > ${w}`);
    }
    return bad;
  });
}

test.describe('Мобильная ширина', () => {
  for (const width of [320, 375, 430]) {
    test(`u048 ширина ${width}: нет горизонтальной прокрутки, элементы не обрезаны, библиотека в 3 колонки`, async ({ app: page, ctx }) => {
      await page.setViewportSize({ width, height: 800 });
      expect(await overflowX(page)).toBeLessThanOrEqual(0);
      expect(await controlsInsideViewport(page)).toEqual([]);
      const cols = await page.locator('#library').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(cols).toBe(3);
      const panels = await page.evaluate(() => [...document.querySelectorAll('.layout > *')].map(e => e.getBoundingClientRect().left));
      expect(new Set(panels.map(Math.round)).size).toBe(1); // одна колонка
      for (const fmt of ['og', 'square', 'vertical'] as FormatId[]) {
        await setFormat(page, fmt);
        expect(await overflowX(page)).toBeLessThanOrEqual(0);
        expect(await controlsInsideViewport(page)).toEqual([]);
        const box = (await page.locator('#canvas svg').boundingBox())!;
        const [W, H] = FORMAT_SIZE[fmt];
        expect(box.width / box.height).toBeCloseTo(W / H, 1);
        expect(box.width).toBeLessThanOrEqual(width);
      }
      expectNoErrors(ctx);
    });
  }

  test('u048 ширина 800: библиотека в 5 колонок; ширина 1100: три колонки страницы', async ({ app: page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    expect(await page.locator('#library').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(5);
    await page.setViewportSize({ width: 1100, height: 900 });
    expect(await page.locator('.layout').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3);
    expect(await page.locator('#library').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
  });

  test('u050 изменение размера окна не меняет координаты композиции', async ({ app: page }) => {
    const before = (await items(page)).map(i => i.transform);
    for (const w of [1400, 700, 375, 320, 1000, 1400]) await page.setViewportSize({ width: w, height: 800 });
    expect((await items(page)).map(i => i.transform)).toEqual(before);
  });
});

test.describe('Мобильный телефон 375×812 (touch)', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('smoke: загрузка, добавление касанием, панель объекта, экспорт', async ({ app: page, ctx }) => {
    await expect(page.locator('#canvas svg')).toBeVisible();
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    expect(await controlsInsideViewport(page)).toEqual([]);
    expect(await page.locator('#canvas svg').evaluate(el => getComputedStyle(el).touchAction)).toBe('none');
    await page.locator('#btn-clear').tap();
    await expect(page.locator('#canvas svg [data-uid]')).toHaveCount(0);
    await page.locator('#library .lib-item', { hasText: /^Лампа$/ }).tap();
    await page.locator('#library .lib-item', { hasText: /^Книга$/ }).tap();
    expect((await items(page)).length).toBe(2);
    expect(await selectedId(page)).toBe('book-main-1');
    await panelBtn(page, 'tone').scrollIntoViewIfNeeded();
    await panelBtn(page, 'tone').tap();
    await panelBtn(page, 'dup').tap();
    expect((await items(page)).length).toBe(3);
    await panelBtn(page, 'del').tap();
    expect((await items(page)).length).toBe(2);
    await segBtn(page, '#seg-format', /Квадрат/).tap();
    await expect(page.locator('#canvas svg')).toHaveAttribute('viewBox', '0 0 1080 1080');
    const { text } = await exportSvg(page);
    await validateExport(page, text, { fmt: FORMAT_SIZE.square, count: 2 });
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
    expectNoErrors(ctx);
  });

  test('u049 перетаскивание пальцем двигает объект и не прокручивает страницу', async ({ app: page }) => {
    await clearAll(page);
    await page.locator('#library .lib-item', { hasText: /^Лампа$/ }).tap();
    await page.locator('#canvas').scrollIntoViewIfNeeded();
    const [it] = await items(page);
    const sy = await page.evaluate(() => scrollY);
    const p = (await hitPoint(page, it.uid))!;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', p.x, p.y);
    for (let i = 1; i <= 10; i++) await touch('touchMove', p.x + i * 5, p.y + i * 6);
    await touch('touchEnd', 0, 0);
    const [moved] = await items(page);
    expect(moved.x).toBeGreaterThan(it.x + 10);
    expect(moved.y).toBeGreaterThan(it.y + 10);
    expect(await page.evaluate(() => scrollY)).toBe(sy);
    // после отпускания жест завершён: движение без касания объект не двигает
    await touch('touchStart', 5, 5);
    await touch('touchMove', 100, 100);
    await touch('touchEnd', 0, 0);
    const [after] = await items(page);
    expect(after.x).toBeCloseTo(moved.x, 3);
  });

  test('u049 поворот ползунком касанием', async ({ app: page }) => {
    await clearAll(page);
    await page.locator('#library .lib-item', { hasText: /^Ручка$/ }).tap();
    const slider = page.locator('#object-panel [data-a=rot]');
    await slider.scrollIntoViewIfNeeded();
    const box = (await slider.boundingBox())!;
    await slider.tap({ position: { x: box.width * 0.5, y: box.height / 2 } });
    const rot = (await items(page))[0].rotation;
    expect(rot).toBeGreaterThan(90);
    expect(rot).toBeLessThan(270);
  });
});
