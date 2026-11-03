import {
  test, expect, items, ids, exportSvg, validateExport, SCHEMES, FORMAT_SIZE, FORMAT_LABEL, LAYOUT_LABEL, submitNames,
  setFormat, setLayout, pressedLabels, noticeText, segBtn, expectNoErrors, panelBtn, clickItem, dragItem, selectedId,
  toneInfo, type FormatId, type LayoutId,
} from './helpers';

/** Охват всех элементов <g data-uid> в координатах кадра (единицы viewBox). */
async function frameBox(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#canvas svg')!;
    const sr = svg.getBoundingClientRect();
    const vb = svg.getAttribute('viewBox')!.split(' ').map(Number);
    const k = vb[2] / sr.width;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const g of svg.querySelectorAll('[data-uid]')) {
      const r = g.getBoundingClientRect();
      x0 = Math.min(x0, (r.left - sr.left) * k); x1 = Math.max(x1, (r.right - sr.left) * k);
      y0 = Math.min(y0, (r.top - sr.top) * k); y1 = Math.max(y1, (r.bottom - sr.top) * k);
    }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, W: vb[2], H: vb[3] };
  });
}

const scales = (its: { scale: number }[]) => [...new Set(its.map(i => i.scale))];

const FORMATS: FormatId[] = ['og', 'square', 'vertical'];
const LAYOUTS: LayoutId[] = ['compact', 'offset', 'title'];
const PRIORITY: Record<string, string> = {
  'og/compact': 'u021', 'og/offset': 'u022', 'og/title': 'u023',
  'square/compact': 'u024', 'square/offset': 'u025', 'square/title': 'u026',
  'vertical/compact': 'u027', 'vertical/offset': 'u028', 'vertical/title': 'u029',
};

test.describe('Форматы и раскладки', () => {
  for (const fmt of FORMATS) for (const layout of LAYOUTS) {
    test(`${PRIORITY[`${fmt}/${layout}`]} ${FORMAT_LABEL[fmt]} × ${LAYOUT_LABEL[layout]}`, async ({ app: page, ctx }) => {
      await submitNames(page, 'книга, телефон, лампа, монета');
      expect(await noticeText(page)).toContain('Подобрано по словарю: книга, телефон, лампа, монета (фон)');
      await setFormat(page, fmt);
      expect(await noticeText(page)).toContain('Раскладка пересобрана');
      await setLayout(page, layout);
      expect(await pressedLabels(page, '#seg-format')).toEqual([FORMAT_LABEL[fmt]]);
      expect(await pressedLabels(page, '#seg-layout')).toEqual([LAYOUT_LABEL[layout]]);

      const [W, H] = FORMAT_SIZE[fmt];
      const list = await items(page);
      expect(list).toHaveLength(4);
      // фоновая монета лежит позади всех; единый масштаб — объекты не растянуты
      expect(list[0].id).toBe('coin-bg-1');
      expect(scales(list)).toHaveLength(1);
      await expect(page.locator('#canvas svg')).toHaveAttribute('viewBox', `0 0 ${W} ${H}`);

      const box = await frameBox(page);
      const centers = await items(page);
      if (layout === 'compact') {
        // группа целиком в кадре, у краёв остаются поля (зона ~7 % слева/справа и ~8 % сверху/снизу)
        expect(box.x0).toBeGreaterThanOrEqual(W * 0.05);
        expect(box.x1).toBeLessThanOrEqual(W * 0.95);
        expect(box.y0).toBeGreaterThanOrEqual(H * 0.05);
        expect(box.y1).toBeLessThanOrEqual(H * 0.95);
        expect(Math.abs(box.cx - W / 2)).toBeLessThan(W * 0.08);
        expect(Math.abs(box.cy - H / 2)).toBeLessThan(H * 0.08);
      } else if (layout === 'offset') {
        // центры объектов остаются в кадре (края могут обрезаться clipPath)
        for (const c of centers) {
          expect(c.x).toBeGreaterThanOrEqual(0); expect(c.x).toBeLessThanOrEqual(W);
          expect(c.y).toBeGreaterThanOrEqual(0); expect(c.y).toBeLessThanOrEqual(H);
        }
      } else if (H > W * 1.2) {
        expect(box.y0).toBeGreaterThanOrEqual(H * 0.42 - H * 0.02); // верх свободен под заголовок
        expect(box.x0).toBeGreaterThanOrEqual(-W * 0.02);
        expect(box.x1).toBeLessThanOrEqual(W * 1.02);
      } else {
        expect(box.x0).toBeGreaterThanOrEqual(W * 0.47 - W * 0.02); // левая половина свободна под текст
      }

      const { text, filename } = await exportSvg(page);
      expect(filename).toBe(`illustration-${fmt}-violet.svg`);
      const r = await validateExport(page, text, { scheme: SCHEMES.violet, fmt: [W, H], count: 4 });
      // порядок <g> в файле совпадает с порядком слоёв на холсте
      expect(r.groupIds).toEqual(await ids(page));
      expect(r.bgFill).toBe(SCHEMES.violet.bg1.toUpperCase());
      expect(r.clipPathUses).toEqual([`url(#frame-${W}x${H})`]);
      expectNoErrors(ctx);
    });
  }

  test('u022 «Со смещением» крупнее «Собранно»', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа, монета');
    await setLayout(page, 'compact');
    const k1 = (await items(page))[0].scale;
    await setLayout(page, 'offset');
    const k2 = (await items(page))[0].scale;
    expect(k2).toBeGreaterThan(k1);
  });

  test('u021 смена формата и раскладки сбрасывает ручные положения и повороты, оттенки сохраняются', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон');
    const list = await items(page);
    await clickItem(page, list[0].uid);
    await panelBtn(page, 'tone').click();
    await page.keyboard.press('r');
    await dragItem(page, list[0].uid, 40, 40);
    const manual = (await items(page))[0];
    expect(manual.rotation).toBe(15);
    await setLayout(page, 'offset');
    const after = (await items(page)).find(i => i.objectId === manual.objectId)!;
    expect(after.rotation).toBe(0);
    expect(after.x).not.toBeCloseTo(manual.x, 0);
    // оттенок: у книги выбран второй
    await clickItem(page, after.uid);
    expect((await toneInfo(page))!.n).toBe(2);
  });

  test('u055 отмена смены формата и раскладки: один клик — один шаг, сегменты совпадают с холстом', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа');
    const [first] = await items(page);
    await dragItem(page, first.uid, 80, 10); // ручная правка
    const base = await items(page);
    await setFormat(page, 'vertical');
    await setLayout(page, 'title');
    expect(await pressedLabels(page, '#seg-layout')).toEqual([LAYOUT_LABEL.title]);
    await page.locator('#btn-undo').click(); // отмена раскладки
    expect(await pressedLabels(page, '#seg-layout')).toEqual([LAYOUT_LABEL.compact]);
    expect(await pressedLabels(page, '#seg-format')).toEqual([FORMAT_LABEL.vertical]);
    await expect(page.locator('#canvas svg')).toHaveAttribute('viewBox', '0 0 1080 1920');
    await page.locator('#btn-undo').click(); // отмена формата — одним шагом
    expect(await pressedLabels(page, '#seg-format')).toEqual([FORMAT_LABEL.og]);
    await expect(page.locator('#canvas svg')).toHaveAttribute('viewBox', '0 0 1200 630');
    const restored = await items(page);
    expect(restored.map(i => i.transform)).toEqual(base.map(i => i.transform));
    await page.locator('#btn-redo').click();
    await page.locator('#btn-redo').click();
    expect(await pressedLabels(page, '#seg-format')).toEqual([FORMAT_LABEL.vertical]);
    expect(await pressedLabels(page, '#seg-layout')).toEqual([LAYOUT_LABEL.title]);
    const { text } = await exportSvg(page);
    await validateExport(page, text, { fmt: FORMAT_SIZE.vertical });
  });

  test('u015 L/S меняет только детализацию: положения, углы и масштаб не меняются', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа, монета');
    await clickItem(page, (await items(page))[1].uid);
    await page.keyboard.press('r');
    const before = await items(page);
    const scaleVal = await page.locator('#in-scale').inputValue();
    const htmlL = await page.locator('#canvas svg').innerHTML();
    await segBtn(page, '#seg-size', /S — проще/).click();
    expect(await pressedLabels(page, '#seg-size')).toEqual(['S — проще']);
    const afterS = await items(page);
    // положения и углы те же (масштаб в transform пересчитан на unitScale)
    expect(afterS.map(i => [i.id, i.x, i.y, i.rotation])).toEqual(before.map(i => [i.id, i.x, i.y, i.rotation]));
    expect(await page.locator('#in-scale').inputValue()).toBe(scaleVal);
    expect(await page.locator('#canvas svg').innerHTML()).not.toBe(htmlL);
    await segBtn(page, '#seg-size', /L — подробнее/).click();
    expect(await pressedLabels(page, '#seg-size')).toEqual(['L — подробнее']);
    expect(await page.locator('#canvas svg').innerHTML()).toBe(htmlL);
  });

  test('u016 новый объект получает текущий размер композиции и вид «главный»', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа');
    for (const size of [/S — проще/, /L — подробнее/]) {
      await segBtn(page, '#seg-size', size).click();
      await page.locator('#library .lib-item', { hasText: /^Ручка$/ }).click();
      const last = (await items(page)).at(-1)!;
      expect(last.variant).toBe('main');
      expect(await selectedId(page)).toBe(last.id);
      await panelBtn(page, 'del').click();
    }
  });
});
