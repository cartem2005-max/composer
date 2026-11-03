import {
  test, expect, items, ids, selectedId, selectionCount, clearAll, addObject, addById, panelBtn, clickItem, dragItem,
  clickEmptyCanvas, exportSvg, validateExport, SCHEMES, OBJECTS, NAME_BY_ID, FORMAT_SIZE, noticeText, expectNoErrors,
  setScheme, schemeByName, savedComposition, submitNames,
} from './helpers';

test.describe('Объекты на холсте', () => {
  test('u001 добавление всех десяти объектов библиотеки', async ({ app: page, ctx }) => {
    await clearAll(page);
    for (const [i, o] of OBJECTS.entries()) {
      await addObject(page, o.name);
      expect(await selectedId(page)).toBe(`${o.id}-main-1`);
      expect(await selectionCount(page)).toBe(1);
      await expect(page.locator('#object-panel .obj-title')).toContainText(o.name);
      const list = await items(page);
      expect(list).toHaveLength(i + 1);
      // объект появился в центре кадра (1200 x 630)
      const last = list[list.length - 1];
      expect(last.x).toBeCloseTo(600, 0);
      expect(last.y).toBeCloseTo(315, 0);
    }
    const all = await ids(page);
    expect(new Set(all).size).toBe(10);
    expect(await noticeText(page)).toBe('');
    expectNoErrors(ctx);
  });

  test('u002 повторное добавление одного типа: независимые слои', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    await addObject(page, 'Книга');
    expect(await ids(page)).toEqual(['book-main-1', 'book-main-2']);
    const [a0, b0] = await items(page);
    await dragItem(page, b0.uid, 150, 60);
    await panelBtn(page, 'tone').click();
    const [a1, b1] = await items(page);
    expect(a1.transform).toBe(a0.transform);
    expect(b1.x).not.toBeCloseTo(b0.x, 0);
    // оттенок второго не влияет на первый
    const html = await page.locator('#canvas svg').innerHTML();
    expect(html).toBeTruthy();
    await clickItem(page, a1.uid);
    expect(await selectedId(page)).toBe('book-main-1');
    await expect(panelBtn(page, 'tone')).toContainText('(1/6)');
    await clickItem(page, b1.uid);
    await expect(panelBtn(page, 'tone')).toContainText('(2/6)');
    const { text } = await exportSvg(page);
    const r = await validateExport(page, text, { count: 2 });
    expect(r.groupIds).toEqual(['book-main-1', 'book-main-2']);
  });

  test('u003 перемещение мышью без скачка, клик по пустому месту снимает выделение', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Телефон');
    const [it0] = await items(page);
    const svgBox = (await page.locator('#canvas svg').boundingBox())!;
    const k = svgBox.width / 1200; // экранных пикселей на единицу кадра
    // схватить не по центру
    const p = (await page.evaluate((uid) => {
      const r = document.querySelector(`[data-uid="${uid}"]`)!.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, it0.uid));
    expect(p.w).toBeGreaterThan(5);
    // сначала просто нажать и отпустить без движения — объект не должен прыгнуть
    await clickItem(page, it0.uid);
    const [still] = await items(page);
    expect(still.x).toBeCloseTo(it0.x, 1);
    expect(still.y).toBeCloseTo(it0.y, 1);
    // перетащить на 100 экранных пикселей вправо и 40 вниз: сдвиг в единицах кадра = 100/k
    await dragItem(page, it0.uid, 100, 40);
    const [moved] = await items(page);
    expect(moved.x - it0.x).toBeCloseTo(100 / k, 0);
    expect(moved.y - it0.y).toBeCloseTo(40 / k, 0);
    // рамка выделения совпадает с объектом
    const box = await page.evaluate(() => {
      const g = document.querySelector('#canvas [data-uid]')!.getBoundingClientRect();
      const s = document.querySelector('#selection')!.getBoundingClientRect();
      return { g: [g.x + g.width / 2, g.y + g.height / 2], s: [s.x + s.width / 2, s.y + s.height / 2] };
    });
    expect(box.s[0]).toBeCloseTo(box.g[0], 0);
    expect(box.s[1]).toBeCloseTo(box.g[1], 0);
    await clickEmptyCanvas(page);
    expect(await selectionCount(page)).toBe(0);
    await expect(page.locator('#object-panel')).toContainText('Выберите объект на холсте');
    await clickItem(page, it0.uid);
    expect(await selectedId(page)).toBe('phone-main-1');
  });

  test('u050/u003 перетаскивание корректно при другом размере предпросмотра', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Лампа');
    await page.setViewportSize({ width: 700, height: 900 });
    const [it0] = await items(page);
    const k = (await page.locator('#canvas svg').boundingBox())!.width / 1200;
    await dragItem(page, it0.uid, 60, -30);
    const [m] = await items(page);
    expect(m.x - it0.x).toBeCloseTo(60 / k, 0);
    expect(m.y - it0.y).toBeCloseTo(-30 / k, 0);
    await page.setViewportSize({ width: 1400, height: 900 });
    const [back] = await items(page);
    expect(back.x).toBeCloseTo(m.x, 3); // координаты кадра не меняются при ресайзе
    const k2 = (await page.locator('#canvas svg').boundingBox())!.width / 1200;
    await dragItem(page, back.uid, -50, 20);
    const [m2] = await items(page);
    expect(m2.x - back.x).toBeCloseTo(-50 / k2, 0);
  });

  test('u004 объект уходит за границы: transform конечный, экспорт обрезается clipPath', async ({ app: page, ctx }) => {
    await clearAll(page);
    await addObject(page, 'Лампа');
    const [it] = await items(page);
    const box = (await page.locator('#canvas svg').boundingBox())!;
    // наполовину за левый край
    await dragItem(page, it.uid, -(box.width / 2) - 20, -(box.height / 4));
    const [half] = await items(page);
    expect(half.x).toBeLessThanOrEqual(1);
    expect(half.y).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(half.x) && Number.isFinite(half.y)).toBeTruthy();
    // остаётся выбираемым
    await clickEmptyCanvas(page);
    await clickItem(page, half.uid);
    expect(await selectedId(page)).toBe('lamp-main-1');
    const { text } = await exportSvg(page);
    const r = await validateExport(page, text, { count: 1, fmt: FORMAT_SIZE.og });
    expect(r.clipPathUses).toEqual(['url(#frame-1200x630)']);
    expectNoErrors(ctx);
  });

  test('u005 поворот: R, Shift+R, ползунок, переход через 0°', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Ручка');
    const rot = () => items(page).then(l => l[0].rotation);
    await page.keyboard.press('r'); await page.keyboard.press('r'); await page.keyboard.press('r');
    expect(await rot()).toBe(45);
    await page.keyboard.press('Shift+R');
    expect(await rot()).toBe(30);
    await expect(page.locator('#object-panel')).toContainText('Поворот: 30°');
    for (const deg of [0, 90, 180, 270, 359]) {
      await page.locator('#object-panel [data-a=rot]').fill(String(deg));
      expect(await rot()).toBe(deg);
      await expect(page.locator('#object-panel')).toContainText(`Поворот: ${deg}°`);
    }
    await page.locator('#object-panel [data-a=rot]').fill('350');
    await page.keyboard.press('r'); await page.keyboard.press('r');
    expect(await rot()).toBe(20);
    await expect(page.locator('#object-panel')).toContainText('Поворот: 20°');
    await page.keyboard.press('Shift+R');
    await page.keyboard.press('Shift+R');
    expect(await rot()).toBe(350);
    // рамка выделения повёрнута вместе с объектом
    const selTf = await page.locator('#selection').getAttribute('transform');
    expect(selTf).toContain('rotate(350)');
    // центр не смещается
    const [it] = await items(page);
    expect(it.x).toBeCloseTo(600, 0);
  });

  test('u006 24 нажатия R возвращают исходный transform', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Папка');
    const first = (await exportSvg(page)).text;
    for (let i = 0; i < 24; i++) await page.keyboard.press('r');
    expect((await items(page))[0].rotation).toBe(0);
    for (let n = 0; n < 3; n++) {
      await page.locator('#object-panel [data-a=rot]').fill('359');
      await page.locator('#object-panel [data-a=rot]').fill('0');
    }
    const second = (await exportSvg(page)).text;
    const tf = (t: string) => /<g id="folder-main-1"[^>]*transform="([^"]*)"/.exec(t)![1];
    expect(tf(second)).toBe(tf(first));
    expect(tf(second)).not.toContain('rotate');
  });

  test('u007 дублирование сохраняет угол, вид и оттенок', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Пазл');
    await page.keyboard.press('r'); await page.keyboard.press('r');
    await panelBtn(page, 'variant').click();
    await panelBtn(page, 'tone').click();
    const [orig] = await items(page);
    expect(orig.variant).toBe('bg');
    await panelBtn(page, 'dup').click();
    const list = await items(page);
    expect(list).toHaveLength(2);
    const copy = list[1];
    expect(copy.x - orig.x).toBeCloseTo(40, 1);
    expect(copy.y - orig.y).toBeCloseTo(30, 1);
    expect(copy.rotation).toBe(30);
    expect(copy.variant).toBe('bg');
    expect(await selectedId(page)).toBe(copy.id);
    await expect(panelBtn(page, 'tone')).toContainText('(2/2)');
    // изменения копии не трогают оригинал
    await dragItem(page, copy.uid, 40, 40);
    await panelBtn(page, 'variant').click();
    const after = await items(page);
    expect(after[0].transform).toBe(orig.transform);
    expect(after[0].variant).toBe('bg');
    expect(after[1].variant).toBe('main');
    const { text } = await exportSvg(page);
    const r = await validateExport(page, text, { count: 2 });
    expect(new Set(r.groupIds).size).toBe(2);
    // ctrl+D тоже дублирует
    await page.keyboard.press('Control+d');
    expect(await items(page)).toHaveLength(3);
  });

  test('u008 удаление: только выбранный, пустой холст остаётся рабочим', async ({ app: page, ctx }) => {
    await clearAll(page);
    await addObject(page, 'Монета');
    await dragItem(page, (await items(page))[0].uid, 250, 0);
    await addObject(page, 'Кошелёк');
    const [coin] = await items(page);
    await clickItem(page, coin.uid);
    await panelBtn(page, 'del').click();
    expect(await ids(page)).toEqual(['wallet-main-1']);
    expect(await selectionCount(page)).toBe(0);
    const [w] = await items(page);
    await clickItem(page, w.uid);
    await page.keyboard.press('Delete');
    expect(await items(page)).toHaveLength(0);
    await expect(page.locator('#object-panel')).toContainText('Выберите объект на холсте');
    expect(await noticeText(page)).toBe('');
    const { text } = await exportSvg(page);
    await validateExport(page, text, { count: 0 });
    expectNoErrors(ctx);
  });

  test('u009 Delete/Backspace без выделения ничего не делают', async ({ app: page, ctx }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    await addObject(page, 'Телефон');
    await clickEmptyCanvas(page);
    const url = page.url();
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Escape');
    expect(await items(page)).toHaveLength(2);
    expect(page.url()).toBe(url);
    expectNoErrors(ctx);
  });

  test('u010 «Выше» и «Наверх» меняют порядок слоёв и перекрытие', async ({ app: page }) => {
    await clearAll(page);
    for (const n of ['Книга', 'Телефон', 'Пазл']) await addObject(page, n);
    // все три в центре: порядок слоёв = порядок добавления
    expect(await ids(page)).toEqual(['book-main-1', 'phone-main-1', 'puzzle-main-1']);
    // выбираем книгу через панель: выделение нижнего объекта, к которому нельзя кликнуть, сделаем разнесением
    const list = await items(page);
    await clickItem(page, list[2].uid);
    await dragItem(page, list[2].uid, 160, 0);
    await clickItem(page, list[1].uid);
    await dragItem(page, list[1].uid, -160, 0);
    const [book] = await items(page);
    await clickItem(page, book.uid);
    expect(await selectedId(page)).toBe('book-main-1');
    await panelBtn(page, 'front').click();
    expect(await ids(page)).toEqual(['phone-main-1', 'book-main-1', 'puzzle-main-1']);
    await panelBtn(page, 'top').click();
    expect(await ids(page)).toEqual(['phone-main-1', 'puzzle-main-1', 'book-main-1']);
    // порядок в экспорте совпадает: последний <g> — верхний
    const { text } = await exportSvg(page);
    const r = await validateExport(page, text, { count: 3 });
    expect(r.groupIds).toEqual(['phone-main-1', 'puzzle-main-1', 'book-main-1']);
    // клавиши ] и [
    await page.keyboard.press('[');
    expect(await ids(page)).toEqual(['phone-main-1', 'book-main-1', 'puzzle-main-1']);
    await page.keyboard.press(']');
    expect(await ids(page)).toEqual(['phone-main-1', 'puzzle-main-1', 'book-main-1']);
  });

  test('u010 визуальное перекрытие совпадает с порядком слоёв', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    await addObject(page, 'Пазл');
    const owner = () => page.evaluate(() => {
      // верхний объект в точке, которая принадлежит обоим: перебираем сетку и берём первую точку с двумя слоями
      const svg = document.querySelector('#canvas svg')!.getBoundingClientRect();
      for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) {
        const x = svg.x + (svg.width * i) / 60, y = svg.y + (svg.height * j) / 60;
        const owners = document.elementsFromPoint(x, y).map(e => e.closest('[data-uid]')?.getAttribute('id')).filter(Boolean) as string[];
        if (new Set(owners).size === 2) return owners[0];
      }
      return null;
    });
    expect(await owner()).toBe('puzzle-main-1');
    await panelBtn(page, 'bottom').click(); // выделен пазл — отправляем вниз
    expect(await ids(page)).toEqual(['puzzle-main-1', 'book-main-1']);
    expect(await owner()).toBe('book-main-1');
  });

  test('u011 крайние позиции слоёв: объекты не пропадают и не дублируются', async ({ app: page }) => {
    await clearAll(page);
    for (const n of ['Книга', 'Телефон', 'Пазл']) await addObject(page, n);
    const order = async () => ids(page);
    // верхний выделен (последний добавленный)
    await panelBtn(page, 'back').click();
    expect(await order()).toEqual(['book-main-1', 'puzzle-main-1', 'phone-main-1']);
    await panelBtn(page, 'bottom').click();
    expect(await order()).toEqual(['puzzle-main-1', 'book-main-1', 'phone-main-1']);
    await panelBtn(page, 'bottom').click();
    await panelBtn(page, 'back').click();
    expect(await order()).toEqual(['puzzle-main-1', 'book-main-1', 'phone-main-1']);
    await panelBtn(page, 'top').click();
    await panelBtn(page, 'front').click();
    expect(await order()).toEqual(['book-main-1', 'phone-main-1', 'puzzle-main-1']);
    expect(await items(page)).toHaveLength(3);
  });

  test('u012 главный/фоновый для каждого из десяти объектов', async ({ app: page }) => {
    await clearAll(page);
    const scheme = SCHEMES.violet;
    for (const o of OBJECTS) {
      await clearAll(page);
      await addObject(page, o.name);
      await page.keyboard.press('r');
      const before = (await items(page))[0];
      const mainHtml = await page.locator('#canvas svg [data-uid]').innerHTML();
      await panelBtn(page, 'variant').click();
      const bg = (await items(page))[0];
      expect(bg.id).toBe(`${o.id}-bg-1`);
      expect(bg.uid).toBe(before.uid);
      expect(bg.x).toBeCloseTo(before.x, 2);
      expect(bg.rotation).toBe(15);
      const bgHtml = await page.locator('#canvas svg [data-uid]').innerHTML();
      const bgColors = new Set([...bgHtml.matchAll(/#[0-9A-Fa-f]{6}/g)].map(m => m[0].toUpperCase()));
      const allowedBg = new Set([scheme.bg1, scheme.bg2, scheme.bg3].map(c => c.toUpperCase()));
      for (const c of bgColors) expect(allowedBg.has(c), `${o.id} bg цвет ${c}`).toBeTruthy();
      await expect(panelBtn(page, 'tone')).toContainText('(1/2)');
      await panelBtn(page, 'variant').click();
      const again = (await items(page))[0];
      expect(again.id).toBe(`${o.id}-main-1`);
      expect(await page.locator('#canvas svg [data-uid]').innerHTML()).toBe(mainHtml);
      await expect(panelBtn(page, 'tone')).toContainText('(1/6)');
    }
  });

  test('u013 оттенки главного объекта: круг 1/6…6/6, только цвета схемы', async ({ app: page }) => {
    for (const [name, id] of [['Фиолетовая', 'violet'], ['Персиковая', 'peach'], ['Бирюзовая', 'teal']] as const) {
      await clearAll(page);
      await setScheme(page, name);
      for (const obj of ['Книга', 'Кошелёк']) {
        await clearAll(page);
        await addObject(page, obj);
        const allowed = new Set(Object.values(SCHEMES[id]).filter(v => v.startsWith('#')).map(c => c.toUpperCase()));
        const seen = new Set<string>();
        for (let n = 1; n <= 6; n++) {
          await expect(panelBtn(page, 'tone')).toContainText(`(${n}/6)`);
          const html = await page.locator('#canvas svg [data-uid]').innerHTML();
          seen.add(html);
          for (const m of html.matchAll(/#[0-9A-Fa-f]{6}/g)) expect(allowed.has(m[0].toUpperCase()), `${id}/${obj}: ${m[0]}`).toBeTruthy();
          await panelBtn(page, 'tone').click();
        }
        await expect(panelBtn(page, 'tone')).toContainText('(1/6)');
        expect(seen.size).toBeGreaterThan(1);
      }
    }
  });

test('БАГ uid: после «Собрать» и добавления из библиотеки data-uid и id объектов не повторяются', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа'); // на старте в композиции 2 объекта, значит nextUid = 3
    await addObject(page, 'Ручка');
    const list = await items(page);
    expect(new Set(list.map(i => i.uid)).size, 'uid: ' + list.map(i => i.uid).join(',')).toBe(list.length);
    // удаление нового объекта не должно задевать лампу
    await panelBtn(page, 'del').click();
    expect((await ids(page)).sort()).toEqual(['book-main-1', 'lamp-main-1', 'phone-main-1']);
  });

  test('u014 оттенки фонового объекта: 1/2, остаётся монохромом в цветах фона', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Тюльпаны в вазе', { bg: true });
    for (const [name, id] of [['Фиолетовая', 'violet'], ['Персиковая', 'peach'], ['Бирюзовая', 'teal']] as const) {
      await setScheme(page, name);
      const s = SCHEMES[id];
      const allowed = new Set([s.bg1, s.bg2, s.bg3].map(c => c.toUpperCase()));
      for (let n = 1; n <= 2; n++) {
        await expect(panelBtn(page, 'tone')).toContainText(`(${n}/2)`);
        const html = await page.locator('#canvas svg [data-uid]').innerHTML();
        const cols = [...html.matchAll(/#[0-9A-Fa-f]{6}/g)].map(m => m[0].toUpperCase());
        expect(cols.length).toBeGreaterThan(0);
        for (const c of cols) expect(allowed.has(c), `${id}: ${c}`).toBeTruthy();
        await panelBtn(page, 'tone').click();
      }
    }
    void schemeByName; void savedComposition; void NAME_BY_ID; void addById;
  });
});
