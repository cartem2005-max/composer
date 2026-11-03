import {
  test, expect, items, ids, selectedId, selectionCount, clearAll, addObject, panelBtn, clickItem, dragItem, clickEmptyCanvas,
  submitNames, hitPoint, SCHEMES, exportSvg, validateExport, pressedLabels, segBtn, setScheme, expectNoErrors, savedComposition,
} from './helpers';

// кнопки «Отменить»/«Вернуть» неактивны, когда нечего отменять/возвращать: тогда нажатие — пустая операция
const press = async (page: import('@playwright/test').Page, id: string) => { const b = page.locator(id); if (await b.isEnabled()) await b.click(); };
const undo = (page: import('@playwright/test').Page) => press(page, '#btn-undo');
const redo = (page: import('@playwright/test').Page) => press(page, '#btn-redo');
const sig = async (page: import('@playwright/test').Page) => JSON.stringify((await items(page)).map(i => [i.id, i.transform]));

test.describe('История: отмена и возврат', () => {
  test('u030 одно перетаскивание — один шаг истории', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Лампа');
    const start = await sig(page);
    const [it] = await items(page);
    await dragItem(page, it.uid, 120, 50, 20);
    const end = await sig(page);
    expect(end).not.toBe(start);
    await undo(page);
    expect(await sig(page)).toBe(start);
    await redo(page);
    expect(await sig(page)).toBe(end);
    // повторная отмена тоже возвращает ровно в начало жеста, а не в промежуточную точку
    await undo(page);
    expect(await sig(page)).toBe(start);
  });

  test('u031 отмена/возврат добавления, дублирования и удаления', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    const s1 = (await items(page)).map(i => i.uid);
    await panelBtn(page, 'dup').click();
    const s2 = (await items(page)).map(i => i.uid);
    expect(s2).toHaveLength(2);
    await clickItem(page, s1[0]);
    await panelBtn(page, 'del').click();
    const s3 = (await items(page)).map(i => i.uid);
    expect(s3).toEqual([s2[1]]);
    await undo(page); expect((await items(page)).map(i => i.uid)).toEqual(s2);
    await undo(page); expect((await items(page)).map(i => i.uid)).toEqual(s1);
    await undo(page); expect(await items(page)).toHaveLength(0);
    await redo(page); expect((await items(page)).map(i => i.uid)).toEqual(s1);
    await redo(page); expect((await items(page)).map(i => i.uid)).toEqual(s2);
    await redo(page); expect((await items(page)).map(i => i.uid)).toEqual(s3);
    await expect(page.locator('#btn-redo')).toBeDisabled(); // больше нечего возвращать
    expect((await items(page)).map(i => i.uid)).toEqual(s3);
  });

  test('u032 отмена поворота, оттенка, вида и порядка — по шагу, панель согласована', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    await dragItem(page, (await items(page))[0].uid, -200, 0);
    await addObject(page, 'Пазл');
    await dragItem(page, (await items(page))[1].uid, -150, 0);
    const base = await ids(page);
    expect(await selectedId(page)).toBe('puzzle-main-1');
    const states: string[] = [await sig(page)];
    await page.keyboard.press('r'); states.push(await sig(page));
    await panelBtn(page, 'tone').click(); states.push(await sig(page));
    await panelBtn(page, 'variant').click(); states.push(await sig(page));
    await panelBtn(page, 'bottom').click(); states.push(await sig(page));
    expect(await ids(page)).toEqual(['puzzle-bg-1', 'book-main-1']);
    for (let i = 3; i >= 0; i--) {
      await undo(page);
      expect(await sig(page), `после отмены шаг ${i}`).toBe(states[i]);
      // панель объекта согласована с холстом
      const sid = await selectedId(page);
      if (sid) expect(await ids(page)).toContain(sid);
    }
    expect(await ids(page)).toEqual(base);
    for (let i = 1; i <= 4; i++) { await redo(page); expect(await sig(page)).toBe(states[i]); }
  });

  test('u032 поворот ползунком — один шаг истории на жест', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Ручка');
    const slider = page.locator('#object-panel [data-a=rot]');
    const box = (await slider.boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    const rotated = (await items(page))[0].rotation;
    expect(rotated).toBeGreaterThan(0);
    await undo(page);
    expect((await items(page))[0].rotation).toBe(0);
  });

  test('u033 новая ветка истории: «Вернуть» после нового действия ничего не делает; границы истории', async ({ app: page }) => {
    const initial = await ids(page); // стартовая композиция по умолчанию
    await clearAll(page);
    await addObject(page, 'Телефон');
    await dragItem(page, (await items(page))[0].uid, 60, 0);
    await page.keyboard.press('r');
    expect((await items(page))[0].rotation).toBe(15);
    await undo(page);
    expect((await items(page))[0].rotation).toBe(0);
    await panelBtn(page, 'tone').click();
    const afterNew = await sig(page);
    await redo(page);
    expect(await sig(page)).toBe(afterNew);
    expect((await items(page))[0].rotation).toBe(0);
    for (let i = 0; i < 15; i++) await undo(page);
    expect(await ids(page)).toEqual(initial);
    const atStart = await sig(page);
    await undo(page); await undo(page);
    expect(await sig(page)).toBe(atStart);
    await expect(page.locator('#btn-undo')).toBeDisabled(); // начало истории
    await expect(page.locator('#btn-redo')).toBeEnabled();
    for (let i = 0; i < 15; i++) await redo(page);
    await redo(page);
    expect(await ids(page)).toEqual(['phone-main-1']);
  });

  test('u034 Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y (и Cmd) совпадают с кнопками и срабатывают один раз', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    await addObject(page, 'Пазл');
    await addObject(page, 'Монета');
    expect(await ids(page)).toHaveLength(3);
    await page.keyboard.press('Control+z');
    expect(await ids(page)).toEqual(['book-main-1', 'puzzle-main-1']);
    await page.keyboard.press('Meta+z');
    expect(await ids(page)).toEqual(['book-main-1']);
    await page.keyboard.press('Control+Shift+z');
    expect(await ids(page)).toEqual(['book-main-1', 'puzzle-main-1']);
    await page.keyboard.press('Control+y');
    expect(await ids(page)).toEqual(['book-main-1', 'puzzle-main-1', 'coin-main-1']);
    await page.keyboard.press('Meta+Shift+z');
    expect(await ids(page)).toHaveLength(3);
    // кнопки: title с подсказкой
    await expect(page.locator('#btn-undo')).toHaveAttribute('title', 'Ctrl+Z');
    await expect(page.locator('#btn-redo')).toHaveAttribute('title', 'Ctrl+Shift+Z');
  });

  test('u035 горячие клавиши с выделением', async ({ app: page }) => {
    await page.setViewportSize({ width: 1000, height: 500 }); // страница прокручиваема
    await clearAll(page);
    await addObject(page, 'Папка');
    const x0 = (await items(page))[0].x, y0 = (await items(page))[0].y;
    const scroll0 = await page.evaluate(() => scrollY);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('ArrowUp');
    const it = (await items(page))[0];
    expect(it.x).toBeCloseTo(x0 + 8 - 20, 1);
    expect(it.y).toBeCloseTo(y0 + 4 - 20 - 4, 1);
    expect(await page.evaluate(() => scrollY)).toBe(scroll0);
    // поворот
    await page.keyboard.press('r');
    expect((await items(page))[0].rotation).toBe(15);
    await page.keyboard.press('Shift+R');
    expect((await items(page))[0].rotation).toBe(0);
  });

  test('u035 Shift+R поворачивает на -15°, Backspace/Delete удаляют, Ctrl+D дублирует, Escape снимает выделение', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Папка');
    await page.keyboard.press('Shift+R');
    expect((await items(page))[0].rotation).toBe(345);
    await page.keyboard.press('Control+d');
    expect(await items(page)).toHaveLength(2);
    await page.keyboard.press('Backspace');
    expect(await items(page)).toHaveLength(1);
    expect(await selectionCount(page)).toBe(0);
    await clickItem(page, (await items(page))[0].uid);
    expect(await selectionCount(page)).toBe(1);
    await page.keyboard.press('Escape');
    expect(await selectionCount(page)).toBe(0);
    await clickItem(page, (await items(page))[0].uid);
    await page.keyboard.press('Delete');
    expect(await items(page)).toHaveLength(0);
  });

  test('u035 без выделения горячие клавиши объекта ничего не делают', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    await addObject(page, 'Телефон');
    await clickEmptyCanvas(page);
    const before = await sig(page);
    for (const k of ['Delete', 'Backspace', 'r', 'Shift+R', '[', ']', 'ArrowLeft', 'ArrowUp', 'Shift+ArrowDown', 'Control+d', 'Escape']) {
      await page.keyboard.press(k);
    }
    expect(await sig(page)).toBe(before);
  });

  test('u036 клавиши в полях ввода редактируют поле, а не объект', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Лампа');
    const before = await sig(page);
    await page.locator('summary', { hasText: 'Загрузить палитру' }).click();
    const fields = ['#in-palette', '#in-metaphor', '#in-names'];
    for (const f of fields) {
      await page.locator(f).click();
      await page.keyboard.type('abc rrr');
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+c');
      await page.keyboard.press('Control+v');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Delete');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('r');
      await page.keyboard.press('Control+d');
      expect(await sig(page), `поле ${f}`).toBe(before);
      expect(await selectionCount(page)).toBe(1);
    }
    // а после выхода из поля клавиши снова работают
    await page.locator('body').click({ position: { x: 5, y: 5 } });
  });

  test('u036 фокус на ползунке «Масштаб»: стрелки двигают ползунок, а не объект', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Лампа');
    const [it0] = await items(page);
    const s0 = Number(await page.locator('#in-scale').inputValue());
    await page.locator('#in-scale').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const s1 = Number(await page.locator('#in-scale').inputValue());
    expect(s1).toBeGreaterThan(s0);
    const [it1] = await items(page);
    expect(it1.x).toBeCloseTo(it0.x, 1); // объект в центре: масштабирование вокруг центра его не двигает
    expect(it1.y).toBeCloseTo(it0.y, 1);
  });

  test('u036 фокус на ползунке «Поворот»: повторные нажатия стрелок крутят ползунок и не сдвигают объект', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Лампа');
    const [it0] = await items(page);
    await page.locator('#object-panel [data-a=rot]').focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    const [it1] = await items(page);
    expect(it1.rotation).toBe(3);
    expect(it1.x).toBeCloseTo(it0.x, 1);
    expect(it1.y).toBeCloseTo(it0.y, 1);
  });

  test('u045 частые клики: 20 добавлений, 10 дублей, одно удаление, история по шагам', async ({ app: page }) => {
    await clearAll(page);
    const lib = page.locator('#library .lib-item', { hasText: /^Книга$/ });
    for (let i = 0; i < 20; i++) await lib.click();
    let list = await items(page);
    expect(list).toHaveLength(20);
    expect(new Set(list.map(i => i.uid)).size).toBe(20);
    for (let i = 0; i < 10; i++) await page.keyboard.press('Control+d');
    list = await items(page);
    expect(list).toHaveLength(30);
    expect(new Set(list.map(i => i.uid)).size).toBe(30);
    for (let i = 0; i < 5; i++) await page.keyboard.press('Delete');
    expect(await items(page)).toHaveLength(29);
    await undo(page); expect(await items(page)).toHaveLength(30);
    for (let i = 0; i < 10; i++) await undo(page);
    expect(await items(page)).toHaveLength(20);
    for (let i = 0; i < 20; i++) await undo(page);
    expect(await items(page)).toHaveLength(0);
  });

  test('u046 быстрые переключения схемы, вида, оттенка и размера — итог равен последним нажатиям', async ({ app: page, ctx }) => {
    await submitNames(page, 'книга, телефон, лампа');
    await clickItem(page, (await items(page))[0].uid);
    const seq = ['Персиковая', 'Бирюзовая', 'Фиолетовая', 'Бирюзовая', 'Персиковая'];
    for (let i = 0; i < seq.length; i++) {
      await setScheme(page, seq[i]);
      await panelBtn(page, 'variant').click();
      await panelBtn(page, 'tone').click();
      await segBtn(page, '#seg-size', i % 2 ? /L —/ : /S —/).click();
    }
    expect(await pressedLabels(page, '#schemes')).toHaveLength(1);
    await expect(page.locator('#schemes .scheme[aria-pressed=true]')).toContainText('Персиковая');
    expect(await pressedLabels(page, '#seg-size')).toEqual(['S — проще']);
    const { text } = await exportSvg(page);
    await validateExport(page, text, { scheme: SCHEMES.peach, count: 3 });
    expect((await savedComposition(page)).schemeId).toBe('peach');
    expectNoErrors(ctx);
  });

  test('u053 отпускание кнопки вне холста завершает жест; повторное движение не двигает объект; новое перетаскивание работает', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Лампа');
    const [it] = await items(page);
    const start = (await hitPoint(page, it.uid))!;
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 400, start.y + 20, { steps: 5 });
    await page.mouse.move(5, 5, { steps: 5 }); // за пределы холста
    await page.mouse.up();
    const dropped = (await items(page))[0];
    // позиция ограничена кадром
    expect(dropped.x).toBeGreaterThanOrEqual(0);
    expect(dropped.x).toBeLessThanOrEqual(1200);
    await page.mouse.move(start.x + 100, start.y + 100, { steps: 5 });
    const later = (await items(page))[0];
    expect(later.x).toBeCloseTo(dropped.x, 3);
    expect(later.y).toBeCloseTo(dropped.y, 3);
    await page.keyboard.press('Escape');
    expect(await selectionCount(page)).toBe(0);
    const again = (await items(page))[0];
    await dragItem(page, again.uid, 30, 0);
    expect((await items(page))[0].x).not.toBeCloseTo(again.x, 0);
  });

  test('u004 перетаскивание ограничено кадром: объект нельзя увезти целиком за край', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Ручка');
    const [it] = await items(page);
    await dragItem(page, it.uid, -3000, -3000, 6);
    const moved = (await items(page))[0];
    expect(moved.x).toBe(0);
    expect(moved.y).toBe(0);
    await dragItem(page, it.uid, 3000, 3000, 6).catch(() => {});
    // объект остаётся выбираемым кликом, если виден хоть частично
    const after = (await items(page))[0];
    expect(after.x).toBeLessThanOrEqual(1200);
    expect(after.y).toBeLessThanOrEqual(630);
  });
});
