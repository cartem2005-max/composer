import {
  test, expect, items, ids, clearAll, addObject, panelBtn, clickItem, dragItem, exportSvg, validateExport, SCHEMES, OBJECTS,
  setFormat, setScheme, submitNames, noticeText, expectNoErrors, analyzeSvg,
} from './helpers';
import type { Page } from '@playwright/test';

async function download(page: Page, button: string) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator(button).click()]);
  const chunks: Buffer[] = [];
  for await (const c of await dl.createReadStream()) chunks.push(Buffer.from(c));
  return { name: dl.suggestedFilename(), data: Buffer.concat(chunks) };
}

test.describe('Экспорт', () => {
  test('u038 SVG остаётся векторным и автономным: все десять объектов', async ({ app: page, ctx }) => {
    await clearAll(page);
    for (const o of OBJECTS) await addObject(page, o.name);
    const { text } = await exportSvg(page);
    const r = await validateExport(page, text, { scheme: SCHEMES.violet, count: 10, fmt: [1200, 630] });
    expect(text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<!-- .*Фиолетовая.* -->/);
    expect(text).not.toMatch(/<image|data:|<script|href=|xlink|https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    expect(r.urlRefs).toEqual(['#frame-1200x630']);
    // автономность: файл открывается как документ без сети
    await page.route('**/*', route => route.continue());
    const doc = await page.evaluate(async (t) => {
      const blob = new Blob([t], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('не загрузился')); img.src = url; });
      return { w: img.naturalWidth, h: img.naturalHeight };
    }, text);
    expect(doc).toEqual({ w: 1200, h: 630 });
    expectNoErrors(ctx);
  });

  test('u039 id групп уникальны после дублирования и удаления', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    await panelBtn(page, 'dup').click();
    await dragItem(page, (await items(page))[1].uid, 200, 0);
    await addObject(page, 'Книга');
    await panelBtn(page, 'dup').click();
    await panelBtn(page, 'tone').click();
    await panelBtn(page, 'del').click(); // удалили копию
    const list = await items(page);
    expect(list).toHaveLength(3);
    const { text } = await exportSvg(page);
    const r = await validateExport(page, text, { count: 3 });
    expect(r.groupIds.every(id => /^book-main-\d+$/.test(id))).toBeTruthy();
    expect(r.groupIds).toEqual(await ids(page));
    expect(r.urlRefs).toEqual(['#frame-1200x630']);
  });

  test('u040 экспорт пустого холста: валидный SVG и PNG одного фона', async ({ app: page }) => {
    await clearAll(page);
    const svg = await exportSvg(page);
    const r = await validateExport(page, svg.text, { count: 0, fmt: [1200, 630], scheme: SCHEMES.violet });
    expect(r.bgFill).toBe(SCHEMES.violet.bg1.toUpperCase());
    expect(svg.text).not.toMatch(/data-uid/);
    const png = await download(page, '#btn-png');
    expect(png.name).toBe('illustration-og-violet.png');
    expect(png.data.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.data.readUInt32BE(16)).toBe(1200);
    expect(png.data.readUInt32BE(20)).toBe(630);
    // добавили и удалили — следов нет
    await addObject(page, 'Лампа');
    await panelBtn(page, 'del').click();
    const again = await exportSvg(page);
    expect(again.text).toBe(svg.text);
  });

  test('u047 экспорт сразу после изменений и повторные клики: файлы одинаковые', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа');
    const it = (await items(page))[1];
    await dragItem(page, it.uid, 40, 20);
    await panelBtn(page, 'tone').click();
    await setFormat(page, 'square');
    const first = await exportSvg(page);
    expect(first.filename).toBe('illustration-square-violet.svg');
    for (let i = 0; i < 5; i++) expect((await exportSvg(page)).text).toBe(first.text);
    await validateExport(page, first.text, { fmt: [1080, 1080], count: 3 });
    const pngs = [];
    for (let i = 0; i < 3; i++) pngs.push(await download(page, '#btn-png'));
    for (const p of pngs) {
      expect(p.name).toBe('illustration-square-violet.png');
      expect(p.data.length).toBeGreaterThan(1000);
      expect(p.data.readUInt32BE(16)).toBe(1080);
      expect(p.data.readUInt32BE(20)).toBe(1080);
    }
    // экспорт совпадает с состоянием на холсте: положение сдвинутого объекта
    const r = await analyzeSvg(page, first.text);
    const onCanvas = await items(page);
    for (const g of onCanvas) expect(r.groupTransforms[g.id]).toBe(g.transform);
  });

  test('экспорт отражает схему, фон, масштаб и формат', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа');
    await setScheme(page, 'Бирюзовая');
    await page.locator('#seg-bg button', { hasText: 'Фон 3' }).click();
    await setFormat(page, 'vertical');
    const { text, filename } = await exportSvg(page);
    expect(filename).toBe('illustration-vertical-teal.svg');
    const r = await validateExport(page, text, { scheme: SCHEMES.teal, fmt: [1080, 1920], count: 3 });
    expect(r.bgFill).toBe(SCHEMES.teal.bg3.toUpperCase());
    // отдельный проход: ползунок масштаба меняет scale в transform
    await page.locator('#in-scale').fill('0.5');
    expect((await items(page))[0].scale).toBeCloseTo(0.5, 4); // L: unitScale = 1
    const after = await analyzeSvg(page, (await exportSvg(page)).text);
    expect(after.groupTransforms[(await ids(page))[0]]).toContain('scale(0.5)');
    void noticeText; void clickItem;
  });
});
