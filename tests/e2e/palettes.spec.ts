import {
  test, expect, items, clearAll, addObject, panelBtn, clickItem, exportSvg, validateExport, submitNames, noticeText,
  pressedLabels, segBtn, expectNoErrors, SCHEMES, analyzeSvg, type Item,
} from './helpers';
import type { Page } from '@playwright/test';

const JSON_PALETTE = '{"name":"Проверочная","bg":["#f1f2f3","#d1d2d3","#b1b2b3"],"obj":["#ff6600","#0066ff","#66cc33"],"black":"#101010","white":"#fefefe"}';
const PALETTE_COLORS = ['#F1F2F3', '#D1D2D3', '#B1B2B3', '#FF6600', '#0066FF', '#66CC33', '#101010', '#FEFEFE'];

async function applyPalette(page: Page, text: string) {
  const details = page.locator('details', { has: page.locator('#in-palette') });
  if (!(await details.evaluate(d => (d as HTMLDetailsElement).open))) await page.locator('summary', { hasText: 'Загрузить палитру' }).click();
  await page.locator('#in-palette').fill(text);
  await page.locator('#btn-palette').click();
}

const schemeButtons = (page: Page) => page.locator('#schemes .scheme');
const activeScheme = (page: Page) => page.locator('#schemes .scheme[aria-pressed=true]');

/** Все цвета (HEX) внутри svg холста без UI-рамки выделения. */
async function canvasColors(page: Page) {
  return page.evaluate(() => {
    const svg = document.querySelector('#canvas svg')!.cloneNode(true) as SVGElement;
    svg.querySelector('#selection')?.remove();
    return [...new Set([...svg.outerHTML.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0].toUpperCase()))];
  });
}

test.describe('Палитры', () => {
  test('u019 JSON-палитра перекрашивает всё и сохраняется после перезагрузки', async ({ app: page, ctx }) => {
    await submitNames(page, 'книга, телефон, фоновая лампа');
    await applyPalette(page, JSON_PALETTE);
    expect(await noticeText(page)).toBe('Палитра «Проверочная» применена ко всей композиции.');
    await expect(activeScheme(page)).toContainText('Проверочная');
    expect(await schemeButtons(page).count()).toBe(4);
    const colors = await canvasColors(page);
    for (const c of colors) expect(PALETTE_COLORS, `цвет ${c} вне палитры`).toContain(c);
    await clickItem(page, (await items(page)).find(i => i.variant === 'main')!.uid);
    await panelBtn(page, 'tone').click();
    await addObject(page, 'Ручка');
    const { text } = await exportSvg(page);
    // uniqueUids: false — известный баг дублирования data-uid после «Собрать» + добавления (см. objects.spec.ts, «БАГ uid»)
    const r = await validateExport(page, text, { count: 4, uniqueUids: false });
    for (const c of r.colors) expect(PALETTE_COLORS).toContain(c.toUpperCase());
    expect(r.bgFill).toBe('#F1F2F3');
    expect(text).toContain('Схема: Проверочная.');
    // чёрный и белый из палитры
    await segBtn(page, '#seg-bg', 'Чёрный').click();
    expect((await analyzeSvg(page, (await exportSvg(page)).text)).bgFill).toBe('#101010');
    // перезагрузка
    await page.reload();
    await expect(schemeButtons(page)).toHaveCount(4);
    await expect(activeScheme(page)).toContainText('Проверочная');
    expect((await analyzeSvg(page, (await exportSvg(page)).text)).bgFill).toBe('#101010');
    expectNoErrors(ctx);
  });

  test('u020 текстовая палитра из шести цветов: имя «Своя 1», чёрный и белый по умолчанию', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, фоновая лампа');
    await applyPalette(page, '#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF');
    await expect(activeScheme(page)).toContainText('Своя 1');
    expect(await noticeText(page)).toContain('Палитра «Своя 1» применена');
    expect(await page.locator('#seg-bg button').allTextContents()).toEqual(['Фон 1', 'Фон 2', 'Фон 3', 'Чёрный']);
    await segBtn(page, '#seg-bg', 'Фон 2').click();
    expect((await analyzeSvg(page, (await exportSvg(page)).text)).bgFill).toBe('#CCCCCC');
    await segBtn(page, '#seg-bg', 'Чёрный').click();
    expect((await analyzeSvg(page, (await exportSvg(page)).text)).bgFill).toBe('#181817');
    // главный/фоновый и оттенки без undefined-цветов
    const first = (await items(page)).find(i => i.variant === 'main')!;
    await clickItem(page, first.uid);
    for (let i = 0; i < 7; i++) await panelBtn(page, 'tone').click();
    await panelBtn(page, 'variant').click();
    await panelBtn(page, 'tone').click();
    await panelBtn(page, 'variant').click();
    const { text } = await exportSvg(page);
    expect(text).not.toMatch(/undefined|NaN/);
    const r = await validateExport(page, text, { scheme: { bg1: '#EEEEEE', bg2: '#CCCCCC', bg3: '#AAAAAA', black: '#181817', obj1: '#FF0000', obj2: '#00FF00', obj3: '#0000FF', white: '#FFFFFF' } });
    expect(r.colors.length).toBeGreaterThan(0);
    // встроенная схема и обратно к палитре
    await schemeButtons(page).filter({ hasText: 'Бирюзовая' }).click();
    await schemeButtons(page).filter({ hasText: 'Своя 1' }).click();
    await expect(activeScheme(page)).toContainText('Своя 1');
  });

  test('u041 восемь цветов дают чёрный и белый из палитры; шесть — значения по умолчанию', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа');
    await applyPalette(page, '#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF #121212 #FAFAFA');
    await segBtn(page, '#seg-bg', 'Чёрный').click();
    expect((await analyzeSvg(page, (await exportSvg(page)).text)).bgFill).toBe('#121212');
    await applyPalette(page, '#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF');
    await segBtn(page, '#seg-bg', 'Чёрный').click();
    // цвета предыдущей палитры не протекают
    expect((await analyzeSvg(page, (await exportSvg(page)).text)).bgFill).toBe('#181817');
  });

  test('u041 палитры, различающиеся только последними цветами, не затирают друг друга', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа');
    await applyPalette(page, '#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF #121212 #FAFAFA');
    await applyPalette(page, '#EEEEEE #CCCCCC #AAAAAA #FF0000 #123456 #654321');
    await expect(schemeButtons(page)).toHaveCount(5);
    await expect(schemeButtons(page).filter({ hasText: 'Своя 1' })).toHaveCount(1);
    await expect(schemeButtons(page).filter({ hasText: 'Своя 2' })).toHaveCount(1);
  });

  test('u042 ошибочная палитра не меняет композицию, схему и экспорт', async ({ app: page, ctx }) => {
    await submitNames(page, 'книга, телефон, фоновая лампа');
    await applyPalette(page, JSON_PALETTE);
    const schemeCount = await schemeButtons(page).count();
    const before = (await exportSvg(page)).text;
    const bad: [string, RegExp][] = [
      ['{"name":"x","bg":["#EEEEEE","#CCCCCC","#AAAAAA"],"obj":["#FF0000","#00FF00","#0000FF"]', /Не удалось прочитать JSON/],
      ['#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF #121212', /найдено 7/],
      ['#GGGGGG #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF', /Нужно 6 или 8 цветов HEX/],
      ['{"bg":["#EEEEEE","#CCCCCC"],"obj":["#FF0000","#00FF00","#0000FF"]}', /ровно 3 цвета фона/],
      ['{"bg":["#EEEEEE","#CCCCCC","не цвет"],"obj":["#FF0000","#00FF00","#0000FF"]}', /не в формате HEX/],
      ['', /Палитра пустая/],
    ];
    for (const [text, re] of bad) {
      await applyPalette(page, text);
      const n = await noticeText(page);
      expect(n, text).toMatch(/^Палитра не принята: /);
      expect(n).toMatch(re);
      await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'error');
      await expect(activeScheme(page)).toContainText('Проверочная');
      expect(await schemeButtons(page).count()).toBe(schemeCount);
    }
    expect((await exportSvg(page)).text).toBe(before);
    expectNoErrors(ctx);
  });

  test('u043 исправление ошибки: уведомление сменяется, сворачивание блока ничего не применяет', async ({ app: page }) => {
    await applyPalette(page, '#EEEEEE #CCCCCC');
    expect(await noticeText(page)).toContain('Палитра не принята');
    const count = await schemeButtons(page).count();
    await page.locator('summary', { hasText: 'Загрузить палитру' }).click(); // свернули
    await page.locator('summary', { hasText: 'Загрузить палитру' }).click(); // развернули
    expect(await schemeButtons(page).count()).toBe(count);
    expect(await noticeText(page)).toContain('Палитра не принята');
    await page.locator('#in-palette').fill('#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF');
    await page.locator('#btn-palette').click();
    expect(await noticeText(page)).toMatch(/^Палитра «Своя 1» применена/);
    await expect(page.locator('#notice')).not.toHaveAttribute('data-kind', 'error');
  });

  test('u044 огромный ввод отклоняется мгновенно; файл больше 50 КБ отклоняется', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа');
    await page.locator('summary', { hasText: 'Загрузить палитру' }).click();
    await page.locator('#in-palette').fill('#112233 '.repeat(100_000));
    const t0 = Date.now();
    await page.locator('#btn-palette').click();
    expect(await noticeText(page)).toMatch(/^Палитра не принята: (Слишком длинный текст палитры|Нужно 6 или 8 цветов HEX, найдено \d+)/);
    expect(Date.now() - t0).toBeLessThan(3000);
    await page.locator('#in-palette').fill('#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF');
    await page.locator('#btn-palette').click();
    expect(await noticeText(page)).toMatch(/применена/);
    // файл
    await page.locator('#file-palette').setInputFiles({ name: 'big.json', mimeType: 'application/json', buffer: Buffer.from(' '.repeat(60_000)) });
    await expect(page.locator('#notice')).toHaveText('Файл палитры слишком большой');
    await page.locator('#file-palette').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON_PALETTE) });
    await expect(page.locator('#notice')).toContainText('Палитра «Проверочная» применена');
    await expect(activeScheme(page)).toContainText('Проверочная');
  });

  test('u052 перезагрузка с пользовательской палитрой; потеря палитры не ломает приложение', async ({ app: page, ctx }) => {
    await submitNames(page, 'книга, телефон, фоновая лампа');
    await applyPalette(page, JSON_PALETTE);
    await clickItem(page, (await items(page)).find(i => i.variant === 'main')!.uid);
    await panelBtn(page, 'tone').click();
    const before = (await items(page)).map(i => i.id);
    const colorsBefore = await canvasColors(page);
    await page.reload();
    await expect(activeScheme(page)).toContainText('Проверочная');
    expect((await items(page)).map(i => i.id)).toEqual(before);
    expect(await canvasColors(page)).toEqual(colorsBefore);
    await clickItem(page, (await items(page)).find(i => i.variant === 'main')!.uid);
    await panelBtn(page, 'tone').click();
    const { text } = await exportSvg(page);
    expect(text).not.toMatch(/undefined|NaN/);
    // удалили палитры, композиция осталась
    await page.evaluate(() => localStorage.removeItem('ochen.customSchemes'));
    await page.reload();
    await expect(page.locator('#canvas svg')).toBeVisible();
    await expect(activeScheme(page)).toContainText('Фиолетовая');
    expect(await noticeText(page)).toContain('Сохранённая палитра не найдена');
    expect((await items(page)).length).toBe(before.length);
    const r = await validateExport(page, (await exportSvg(page)).text, { scheme: SCHEMES.violet });
    expect(r.groupIds.length).toBe(before.length);
    expectNoErrors(ctx);
  });

  test('u056 имя палитры со спецсимволами: файл валиден, в комментарии нет <, >, &, --', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа');
    const name = 'Тест / : * ? " < > | 🎨 --x &';
    await applyPalette(page, JSON.stringify({ name, bg: ['#EEEEEE', '#CCCCCC', '#AAAAAA'], obj: ['#FF0000', '#00FF00', '#0000FF'] }));
    await expect(activeScheme(page)).toContainText('Тест / : * ? " < > | 🎨 --x &');
    const first = await exportSvg(page);
    expect(first.filename).toMatch(/^illustration-og-custom-[0-9a-f]{24,64}\.svg$/);
    const second = await exportSvg(page);
    expect(second.text).toBe(first.text);
    const r = await analyzeSvg(page, first.text);
    expect(r.parseError).toBeNull();
    const comment = /<!--([\s\S]*?)-->/.exec(first.text)![1];
    expect(comment).not.toMatch(/[<>&]|--/);
    expect(comment).toContain('🎨');
    // длинное имя обрезается до 40 символов
    await applyPalette(page, JSON.stringify({ name: 'Я'.repeat(80), bg: ['#EEEEEE', '#CCCCCC', '#AAAAAB'], obj: ['#FF0000', '#00FF00', '#0000FF'] }));
    await expect(activeScheme(page)).toContainText('Я'.repeat(40));
    expect((await activeScheme(page).textContent())!.includes('Я'.repeat(41))).toBeFalsy();
  });

  test('u056 управляющие символы в имени палитры не ломают XML экспорта', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа');
    await applyPalette(page, JSON.stringify({ name: 'a\u0001b\u0008c', bg: ['#EEEEEE', '#CCCCCC', '#AAAAAA'], obj: ['#FF0000', '#00FF00', '#0000FF'] }));
    const { text } = await exportSvg(page);
    const r = await analyzeSvg(page, text);
    expect(r.parseError).toBeNull();
  });

  test('u057 HTML в имени палитры выводится как текст и не исполняется (в том числе после перезагрузки)', async ({ app: page, ctx }) => {
    const dialogs: string[] = [];
    page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });
    await submitNames(page, 'книга, лампа');
    const evil = '<img src=x onerror=alert(1)>';
    await applyPalette(page, JSON.stringify({ name: evil, bg: ['#EEEEEE', '#CCCCCC', '#AAAAAA'], obj: ['#FF0000', '#00FF00', '#0000FF'] }));
    await expect(activeScheme(page)).toContainText(evil);
    await expect(page.locator('#schemes img, #notice img')).toHaveCount(0);
    await expect(page.locator('#notice')).toContainText(evil);
    await expect(activeScheme(page)).toHaveAttribute('title', evil);
    const { text } = await exportSvg(page);
    const comment = /<!--([\s\S]*?)-->/.exec(text)![1];
    expect(comment).not.toMatch(/[<>&]/);
    expect((await analyzeSvg(page, text)).parseError).toBeNull();
    await page.reload();
    await expect(activeScheme(page)).toContainText(evil);
    await expect(page.locator('#schemes img')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
    expectNoErrors(ctx);
  });

  test('palette-xss JSON и текст: имена-скрипты, прототип и вложенные структуры не ломают приложение', async ({ app: page, ctx }) => {
    await submitNames(page, 'книга, лампа');
    const cases = [
      JSON.stringify({ name: '</script><script>alert(1)</script>', bg: ['#EEEEEE', '#CCCCCC', '#AAAAAA'], obj: ['#FF0000', '#00FF00', '#0000FF'] }),
      '{"__proto__":{"x":1},"name":"p","bg":["#EEEEEE","#CCCCCC","#AAAAAA"],"obj":["#FF0000","#00FF00","#0000FF"]}',
      '[{"name":"arr","bg":["#EEEEEE","#CCCCCC","#AAAAAA"],"obj":["#FF0000","#00FF00","#0000FF"]}]',
      '{"name":{"a":1},"bg":["#EEEEEE","#CCCCCC","#AAAAAA"],"obj":["#FF0000","#00FF00","#0000FF"]}',
      'null', '[]', '{"bg":null,"obj":null}', '"строка"', '12345',
    ];
    for (const c of cases) {
      await applyPalette(page, c);
      expect(await noticeText(page), c).toMatch(/Палитра/);
      await expect(page.locator('#canvas svg')).toBeVisible();
    }
    expect((await page.evaluate(() => ({} as any).x))).toBeUndefined();
    const { text } = await exportSvg(page);
    expect((await analyzeSvg(page, text)).parseError).toBeNull();
    expectNoErrors(ctx);
  });
});
void clearAll; void ({} as Item);
