import {
  test, expect, items, ids, selectionCount, clearAll, addObject, panelBtn, clickItem, dragItem, submitNames, setFormat, setLayout,
  setScheme, pressedLabels, segBtn, savedComposition, expectNoErrors, exportSvg, validateExport, SCHEMES, FORMAT_LABEL, LAYOUT_LABEL,
} from './helpers';

test.describe('Сохранение и перезагрузка', () => {
  test('u051 перезагрузка восстанавливает композицию целиком; история и выделение пусты', async ({ app: page, ctx }) => {
    await submitNames(page, 'книга, телефон, лампа, монета');
    await page.reload(); // см. БАГ uid (objects.spec.ts): обход, чтобы дальше работать с нормальными uid
    await setFormat(page, 'vertical');
    await setLayout(page, 'title');
    await setScheme(page, 'Персиковая');
    await segBtn(page, '#seg-bg', 'Фон 3').click();
    await segBtn(page, '#seg-size', /S — проще/).click();
    await page.locator('#in-decor').uncheck();
    const main = (await items(page)).find(i => i.variant === 'main')!;
    await dragItem(page, main.uid, 25, 40);
    await page.keyboard.press('r'); await page.keyboard.press('r');
    await panelBtn(page, 'tone').click();
    await panelBtn(page, 'top').click();
    await page.locator('#in-scale').fill('0.7');
    const saved = await savedComposition(page);
    expect(saved.format).toBe('vertical');
    expect(saved.layout).toBe('title');
    const beforeItems = await items(page);
    const beforeSvg = (await exportSvg(page)).text;

    await page.reload();
    await expect(page.locator('#canvas svg')).toBeVisible();
    const after = await items(page);
    expect(after.map(i => [i.id, i.transform])).toEqual(beforeItems.map(i => [i.id, i.transform]));
    expect(await pressedLabels(page, '#seg-format')).toEqual([FORMAT_LABEL.vertical]);
    expect(await pressedLabels(page, '#seg-layout')).toEqual([LAYOUT_LABEL.title]);
    expect(await pressedLabels(page, '#seg-size')).toEqual(['S — проще']);
    expect(await pressedLabels(page, '#seg-bg')).toEqual(['Фон 3']);
    await expect(page.locator('#schemes .scheme[aria-pressed=true]')).toContainText('Персиковая');
    await expect(page.locator('#in-scale')).toHaveValue('0.7');
    await expect(page.locator('#in-decor')).not.toBeChecked();
    expect(await selectionCount(page)).toBe(0);
    // uid при загрузке нумеруются заново по порядку слоёв, поэтому сравниваем без data-uid
    const noUid = (t: string) => t.replace(/ data-uid="\d+"/g, '');
    expect(noUid((await exportSvg(page)).text)).toBe(noUid(beforeSvg));
    // история пуста: отмена и возврат ничего не меняют
    await expect(page.locator('#btn-undo')).toBeDisabled();
    await expect(page.locator('#btn-redo')).toBeDisabled();
    await page.keyboard.press('Control+z');
    expect((await items(page)).map(i => i.transform)).toEqual(beforeItems.map(i => i.transform));
    await page.keyboard.press('Control+Shift+z');
    expect((await items(page)).map(i => i.transform)).toEqual(beforeItems.map(i => i.transform));
    // оттенок сохранён
    const rotated = (await items(page)).find(i => i.id === main.id)!;
    expect(rotated.rotation).toBe(30);
    await clickItem(page, rotated.uid);
    await expect(panelBtn(page, 'tone')).toContainText('(2/');
    expectNoErrors(ctx);
  });

  test('u051 композиция открывается во второй вкладке того же браузера', async ({ app: page, context }) => {
    await clearAll(page);
    await addObject(page, 'Ручка');
    await addObject(page, 'Папка', { bg: true });
    const second = await context.newPage();
    await second.goto('/');
    await second.locator('#canvas svg').waitFor();
    expect(await items(second).then(l => l.map(i => i.id))).toEqual(['folder-bg-1', 'pen-main-1']);
    await second.close();
  });

  test('сохранение работает после каждой операции (localStorage синхронен с холстом)', async ({ app: page }) => {
    await clearAll(page);
    expect((await savedComposition(page)).items).toHaveLength(0);
    await addObject(page, 'Лампа');
    expect((await savedComposition(page)).items).toHaveLength(1);
    await page.keyboard.press('r');
    expect((await savedComposition(page)).items[0].rotation).toBe(15);
    await page.keyboard.press('Control+z');
    expect((await savedComposition(page)).items[0].rotation).toBe(0);
    await dragItem(page, (await items(page))[0].uid, 50, 0);
    const saved = (await savedComposition(page)).items[0];
    expect(saved.x).toBeCloseTo((await items(page))[0].x, 1);
  });

  test('повреждённое localStorage: приложение стартует с примером и без ошибок', async ({ app: page, ctx }) => {
    for (const bad of ['{oops', 'null', '[]', '12', '"x"', '{"items":"no"}', '{"items":[{"objectId":"dragon"}]}']) {
      await page.evaluate(v => localStorage.setItem('ochen.composition', v), bad);
      await page.reload();
      await expect(page.locator('#canvas svg')).toBeVisible();
      const svgOk = await page.evaluate(() => !/NaN|undefined/.test(document.querySelector('#canvas svg')!.outerHTML));
      expect(svgOk, bad).toBeTruthy();
      await addObject(page, 'Книга'); // приложение работоспособно
    }
    expectNoErrors(ctx);
  });

  test('чужие/враждебные значения в сохранении ограничиваются: конечные координаты, известные схемы, не более 40 объектов', async ({ app: page, ctx }) => {
    const items40 = Array.from({ length: 60 }, (_, i) => ({ objectId: 'book', variant: 'main', tone: 99, x: 1e308, y: -1e308, rotation: 'abc', uid: 5 }));
    await page.evaluate(items => localStorage.setItem('ochen.composition', JSON.stringify({
      format: 'bogus', layout: '<script>', size: 'XXL', schemeId: '<img src=x onerror=alert(1)>', background: 'nope', scale: -5, items,
    })), items40);
    await page.reload();
    await expect(page.locator('#canvas svg')).toBeVisible();
    const list = await items(page);
    expect(list.length).toBeLessThanOrEqual(40);
    for (const i of list) { expect(Number.isFinite(i.x) && Number.isFinite(i.y) && Number.isFinite(i.scale)).toBeTruthy(); }
    expect(await pressedLabels(page, '#seg-format')).toEqual([FORMAT_LABEL.og]);
    expect(await pressedLabels(page, '#seg-layout')).toEqual([LAYOUT_LABEL.compact]);
    await expect(page.locator('#schemes .scheme[aria-pressed=true]')).toContainText('Фиолетовая');
    const { text } = await exportSvg(page);
    await validateExport(page, text, { scheme: SCHEMES.violet, fmt: [1200, 630], uniqueUids: true });
    expectNoErrors(ctx);
  });

  test('повреждённые пользовательские палитры в localStorage игнорируются', async ({ app: page, ctx }) => {
    for (const bad of ['{oops', '{"a":1}', '[1,null,{"id":5}]', '[{"id":"x","bg1":"не цвет"}]']) {
      await page.evaluate(v => localStorage.setItem('ochen.customSchemes', v), bad);
      await page.reload();
      await expect(page.locator('#schemes .scheme')).toHaveCount(3);
    }
    expectNoErrors(ctx);
  });

  test('недоступное localStorage (бросает исключение): приложение работает без сохранения', async ({ page, ctx }) => {
    await page.addInitScript(() => {
      const boom = () => { throw new DOMException('denied', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
    });
    await page.goto('/');
    await expect(page.locator('#canvas svg')).toBeVisible();
    await addObject(page, 'Книга');
    await panelBtn(page, 'dup').click();
    expect((await ids(page)).length).toBeGreaterThanOrEqual(2);
    expectNoErrors(ctx);
  });
});
