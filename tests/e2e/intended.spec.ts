import { inflateRawSync } from 'node:zlib';
import {
  test, expect, items, ids, selectedId, addObject, panelBtn, clickItem, hitPoint, dragItem, exportSvg, validateExport, submitNames,
  setFormat, noticeText, pressedLabels, savedComposition, toneInfo, clearAll, SCHEMES, FORMAT_SIZE, expectNoErrors, analyzeSvg,
} from './helpers';
import type { Page } from '@playwright/test';

/** Минимальный разбор zip (fflate кладёт размеры в локальный заголовок): имя → текст файла. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let o = 0;
  while (buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8), csize = buf.readUInt32LE(o + 18);
    const nlen = buf.readUInt16LE(o + 26), xlen = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + nlen).toString('utf8');
    const data = buf.subarray(o + 30 + nlen + xlen, o + 30 + nlen + xlen + csize);
    out[name] = (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    o += 30 + nlen + xlen + csize;
  }
  return out;
}

const key = (page: Page, init: { key: string; code: string; ctrlKey?: boolean; shiftKey?: boolean }) =>
  page.evaluate(i => !document.dispatchEvent(new KeyboardEvent('keydown', { ...i, bubbles: true, cancelable: true })), init); // true — отменено preventDefault

test.describe('Изменённое поведение (стартовая композиция, оттенки, e.code, перетаскивание, история, zip)', () => {
  test('1. стартовая композиция: 1200×630, «Собранно», наушники + фоновые тюльпаны, декор включён, подсказка', async ({ app: page, ctx }) => {
    expect((await ids(page)).sort()).toEqual(['headphones-main-1', 'tulips-bg-1']);
    expect((await items(page))[0].id).toBe('tulips-bg-1'); // фоновый ниже
    await expect(page.locator('#canvas svg')).toHaveAttribute('viewBox', '0 0 1200 630');
    expect(await pressedLabels(page, '#seg-layout')).toEqual(['Собранно']);
    await expect(page.locator('#in-decor')).toBeChecked();
    await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'hint');
    await expect(page.locator('#notice')).toContainText('Введите заголовок статьи');
    expect(await page.locator('#notice').isVisible()).toBeTruthy();
    expectNoErrors(ctx);
  });

  test('1. подсказка уходит после первого же действия (любого)', async ({ app: page }) => {
    await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'hint');
    await clickItem(page, (await items(page)).find(i => i.variant === 'main')!.uid); // даже выделение — действие
    await expect(page.locator('#notice')).toBeHidden();
    expect(await noticeText(page)).toBe('');
  });

  test('1. подсказка уходит и после других действий: библиотека, формат, ввод названий', async ({ app: page }) => {
    await page.locator('#library .lib-item').first().click();
    await expect(page.locator('#notice')).toBeHidden();
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'hint');
    await setFormat(page, 'square');
    await expect(page.locator('#notice')).not.toHaveAttribute('data-kind', 'hint');
  });

  test('2. «Другие цвета»: счётчик только по различимым оттенкам, кнопка скрыта при одном', async ({ app: page }) => {
    let hidden = 0, shown = 0;
    for (const variantBg of [false, true]) {
      for (const name of ['Книга', 'Телефон', 'Пазл', 'Монета', 'Наушники', 'Лампа', 'Тюльпаны в вазе', 'Кошелёк', 'Папка', 'Ручка']) {
        await clearAll(page);
        await addObject(page, name, { bg: variantBg });
        const info = await toneInfo(page);
        if (!info) { hidden++; await expect(panelBtn(page, 'tone')).toHaveCount(0); continue; }
        shown++;
        expect(info.n).toBe(1);
        expect(info.total).toBeGreaterThanOrEqual(2);
        expect(info.total).toBeLessThanOrEqual(variantBg ? 2 : 6);
        const looks = new Set<string>();
        for (let i = 0; i < info.total; i++) { looks.add(await page.locator('#canvas svg [data-uid]').innerHTML()); await panelBtn(page, 'tone').click(); }
        expect(looks.size, `${name}${variantBg ? ' (фон)' : ''}: ${info.total} оттенков должны отличаться`).toBe(info.total);
        expect((await toneInfo(page))!.n).toBe(1);
      }
    }
    expect(shown).toBeGreaterThan(0);
    console.log(`оттенки: с кнопкой ${shown}, скрыта ${hidden}`);
  });

  test('3. горячие клавиши по e.code: работают при русской раскладке, Ctrl+D всегда отменяет действие браузера', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Папка');
    await key(page, { key: 'к', code: 'KeyR' }); // «к» на русской раскладке
    expect((await items(page))[0].rotation).toBe(15);
    await key(page, { key: 'К', code: 'KeyR', shiftKey: true });
    expect((await items(page))[0].rotation).toBe(0);
    expect(await key(page, { key: 'в', code: 'KeyD', ctrlKey: true })).toBe(true);
    expect(await items(page)).toHaveLength(2);
    await key(page, { key: 'я', code: 'KeyZ', ctrlKey: true }); // Ctrl+Я
    expect(await items(page)).toHaveLength(1);
    await key(page, { key: 'я', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    expect(await items(page)).toHaveLength(2);
    await key(page, { key: 'н', code: 'KeyY', ctrlKey: true });
    // слои: ъ и х на русской раскладке
    const before = await ids(page);
    await key(page, { key: 'х', code: 'BracketLeft' });
    await key(page, { key: 'ъ', code: 'BracketRight' });
    expect(await ids(page)).toEqual(before);
    // Playwright-вариант с физическими кодами
    await page.keyboard.press('Control+KeyZ'); // два шага слоёв ([ и ]) и затем дубликат
    await page.keyboard.press('Control+KeyZ');
    expect(await items(page)).toHaveLength(2);
    await page.keyboard.press('Control+KeyZ');
    expect(await items(page)).toHaveLength(1);
    await page.keyboard.press('Control+KeyY');
    expect(await items(page)).toHaveLength(2);
    // Ctrl+D без выделения всё равно не должен уходить браузеру (закладки)
    await page.keyboard.press('Escape');
    expect(await key(page, { key: 'd', code: 'KeyD', ctrlKey: true })).toBe(true);
    expect(await items(page)).toHaveLength(2);
  });

  test('4. при перетаскивании обновляется только холст; панели и localStorage — на отпускании', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Лампа');
    const [it] = await items(page);
    const savedBefore = (await savedComposition(page)).items[0];
    const p = (await hitPoint(page, it.uid))!;
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 120, p.y + 60, { steps: 10 });
    const mid = (await items(page))[0];
    expect(mid.x).toBeGreaterThan(it.x + 20); // холст двигается сразу
    const savedMid = (await savedComposition(page)).items[0];
    expect(savedMid.x).toBeCloseTo(savedBefore.x, 3); // а сохранение ещё нет
    expect(savedMid.y).toBeCloseTo(savedBefore.y, 3);
    await page.mouse.up();
    // панели и сохранение догоняют на отпускании
    await expect.poll(async () => (await savedComposition(page)).items[0].x).toBeCloseTo(mid.x, 1);
    expect((await savedComposition(page)).items[0].y).toBeCloseTo(mid.y, 1);
    expect(await selectedId(page)).toBe('lamp-main-1');
    await expect(page.locator('#btn-undo')).toBeEnabled();
    // один жест — один шаг отмены
    await page.locator('#btn-undo').click();
    expect((await items(page))[0].x).toBeCloseTo(it.x, 1);
  });

  test('5. «Отменить»/«Вернуть» неактивны, когда нечего отменять/возвращать', async ({ app: page }) => {
    await expect(page.locator('#btn-undo')).toBeDisabled();
    await expect(page.locator('#btn-redo')).toBeDisabled();
    await page.keyboard.press('Control+z'); // пустая операция, без ошибок
    await addObject(page, 'Книга');
    await expect(page.locator('#btn-undo')).toBeEnabled();
    await expect(page.locator('#btn-redo')).toBeDisabled();
    await page.locator('#btn-undo').click();
    await expect(page.locator('#btn-undo')).toBeDisabled();
    await expect(page.locator('#btn-redo')).toBeEnabled();
    await page.locator('#btn-redo').click();
    await expect(page.locator('#btn-redo')).toBeDisabled();
    await expect(page.locator('#btn-undo')).toBeEnabled();
    // новое действие после отмены сбрасывает «Вернуть»
    await page.locator('#btn-undo').click();
    await addObject(page, 'Ручка');
    await expect(page.locator('#btn-redo')).toBeDisabled();
    // жест перетаскивания тоже даёт шаг истории
    await page.locator('#btn-undo').click();
    await expect(page.locator('#btn-undo')).toBeDisabled();
    const lamp = await (async () => { await addObject(page, 'Лампа'); return (await items(page)).at(-1)!; })();
    await page.locator('#btn-undo').click();
    await page.locator('#btn-redo').click();
    await dragItem(page, lamp.uid, 50, 0);
    await expect(page.locator('#btn-redo')).toBeDisabled();
  });

  test('6. переключатель «Добавлять главным / фоновым» и Shift+клик — другим видом', async ({ app: page }) => {
    await clearAll(page);
    expect(await pressedLabels(page, '#seg-add')).toEqual(['Добавлять главным']);
    expect(await page.locator('#seg-add button').allTextContents()).toEqual(['Добавлять главным', 'фоновым']);
    await addObject(page, 'Книга');
    await addObject(page, 'Лампа', { bg: true }); // Shift+клик при «главным» — фоновый
    expect((await ids(page)).sort()).toEqual(['book-main-1', 'lamp-bg-1']);
    await page.locator('#seg-add button', { hasText: 'фоновым' }).click();
    expect(await pressedLabels(page, '#seg-add')).toEqual(['фоновым']);
    expect((await ids(page)).sort()).toEqual(['book-main-1', 'lamp-bg-1']); // переключатель композицию не трогает
    await expect(page.locator('#btn-undo')).toBeEnabled(); // история прежняя
    await addObject(page, 'Ручка'); // обычный клик теперь — фоновый
    await addObject(page, 'Папка', { bg: true }); // Shift+клик — главный
    expect((await ids(page)).sort()).toEqual(['book-main-1', 'folder-main-1', 'lamp-bg-1', 'pen-bg-1']);
    await expect(page.locator('#library .lib-item').first()).toHaveAttribute('title', /клик — фоновый, Shift\+клик — главный/);
    await page.locator('#seg-add button', { hasText: 'Добавлять главным' }).click();
    await expect(page.locator('#library .lib-item').first()).toHaveAttribute('title', /клик — главный, Shift\+клик — фоновый/);
    // переключатель переживает смену схемы (библиотека перерисовывается)
    await page.locator('#seg-add button', { hasText: 'фоновым' }).click();
    await page.locator('#schemes .scheme', { hasText: 'Бирюзовая' }).click();
    expect(await pressedLabels(page, '#seg-add')).toEqual(['фоновым']);
  });

  for (const current of ['og', 'square', 'vertical'] as const) {
    test(`7. «Все форматы (zip)»: файл текущего формата (${current}) равен холсту с ручными правками`, async ({ app: page, ctx }) => {
      await submitNames(page, 'книга, телефон, лампа');
      await page.reload();
      await setFormat(page, current);
      const main = (await items(page)).find(i => i.variant === 'main')!;
      await dragItem(page, main.uid, 35, 20);
      await page.keyboard.press('r');
      await page.keyboard.press('r');
      await panelBtn(page, 'tone').click().catch(() => {}); // у части объектов один оттенок — кнопки нет
      const canvasSvg = (await exportSvg(page)).text;
      const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-formats').click()]);
      expect(dl.suggestedFilename()).toBe('illustrations-violet.zip');
      const chunks: Buffer[] = [];
      for await (const c of await dl.createReadStream()) chunks.push(Buffer.from(c));
      const files = unzip(Buffer.concat(chunks));
      expect(Object.keys(files).sort()).toEqual(['og', 'square', 'vertical'].map(f => `illustration-${f}-violet.svg`).sort());
      expect(files[`illustration-${current}-violet.svg`]).toBe(canvasSvg); // ручные правки сохранены байт в байт
      for (const f of ['og', 'square', 'vertical'] as const) {
        const text = files[`illustration-${f}-violet.svg`];
        const r = await validateExport(page, text, { scheme: SCHEMES.violet, fmt: FORMAT_SIZE[f], count: 3 });
        expect(r.groupIds.sort()).toEqual(['book-main-1', 'lamp-main-1', 'phone-main-1']);
        if (f !== current) {
          // остальные форматы разложены автоматически: поворота нет, положения не совпадают с ручными
          expect(Object.values(r.groupTransforms).some(t => t.includes('rotate'))).toBeFalsy();
        }
      }
      expect(Object.values((await analyzeSvg(page, files[`illustration-${current}-violet.svg`])).groupTransforms).some(t => t.includes('rotate'))).toBeTruthy();
      expectNoErrors(ctx);
    });
  }
});
