import {
  test, expect, items, ids, selectedId, noticeText, submitNames, clickItem, dragItem, panelBtn, setFormat, setLayout, setScheme,
  exportSvg, validateExport, analyzeSvg, SCHEMES, expectNoErrors, DEFAULT_PICK, OBJECTS, NAME_BY_ID, pressedLabels, type Ctx,
} from './helpers';
import type { Page } from '@playwright/test';

const metaphor = async (page: Page, text: string) => {
  await page.locator('#in-metaphor').fill(text);
  await page.locator('#form-metaphor button[type=submit]').click();
};

/** Сетевые ошибки подмены (500, abort) браузер пишет в console.error — это не ошибки приложения. */
const appErrors = (ctx: Ctx) => ctx.errors.filter(e => !/Failed to load resource/.test(e));

const json = (body: unknown, status = 200) => (route: import('@playwright/test').Route) =>
  route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });

const libraryNames = OBJECTS.map(o => o.id);

test.describe('Подбор: метафора (ИИ с подменой) и запасной словарь', () => {
  test('ИИ отвечает: композиция из ответа, уведомление «Подобрал ИИ»', async ({ app: page, ctx }) => {
    await metaphor(page, 'Как превратить знания в доход');
    await expect(page.locator('#notice')).toContainText('Подобрал ИИ');
    expect(await noticeText(page)).toBe('Подобрал ИИ: лампа, книга (фон). тест');
    expect(await ids(page)).toEqual(['book-bg-1', 'lamp-main-1']);
    expect(ctx.pickCalls.count).toBe(1);
    expect(JSON.parse(ctx.pickCalls.bodies[0])).toEqual({ text: 'Как превратить знания в доход' });
    expect(await selectedId(page)).toBeNull();
    expectNoErrors(ctx);
  });

  test('u058 кнопка на время запроса «Подбираю…» и блокируется, потом возвращается', async ({ app: page, ctx }) => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    await ctx.mockPick(async route => { await gate; await json(DEFAULT_PICK)(route); });
    const btn = page.locator('#form-metaphor button[type=submit]');
    await metaphor(page, 'Как накопить на отпуск');
    await expect(btn).toHaveText('Подбираю…');
    await expect(btn).toBeDisabled();
    release();
    await expect(btn).toHaveText('Собрать');
    await expect(btn).toBeEnabled();
    await expect(page.locator('#notice')).toContainText('Подобрал ИИ');
  });

  test('u058 ошибка сервера 500: запасной словарь, композиция из 1–4 объектов библиотеки', async ({ app: page, ctx }) => {
    await ctx.mockPick(json({ error: 'boom' }, 500));
    await metaphor(page, 'Как накопить на отпуск');
    await expect(page.locator('#notice')).toContainText('Подобрано по словарю');
    expect(await noticeText(page)).toContain('ИИ сейчас недоступен, поэтому сработал запасной словарь');
    const list = await items(page);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeLessThanOrEqual(5);
    for (const i of list) expect(libraryNames).toContain(i.objectId);
    await expect(page.locator('#form-metaphor button[type=submit]')).toHaveText('Собрать');
    expect(appErrors(ctx)).toEqual([]);
  });

  test('u058 сеть недоступна (abort): словарь, кнопка снова активна, после восстановления снова «Подобрал ИИ»', async ({ app: page, ctx }) => {
    await ctx.mockPick(route => route.abort('internetdisconnected'));
    await metaphor(page, 'Как накопить на отпуск');
    await expect(page.locator('#notice')).toContainText('запасной словарь');
    await expect(page.locator('#form-metaphor button[type=submit]')).toBeEnabled();
    await ctx.mockPick(json(DEFAULT_PICK));
    await metaphor(page, 'Как накопить на отпуск');
    await expect(page.locator('#notice')).toContainText('Подобрал ИИ');
    expect(appErrors(ctx)).toEqual([]);
  });

  test('u058 таймаут ИИ (12 с): уведомление «не ответил вовремя», запасной словарь', async ({ app: page, ctx }) => {
    test.setTimeout(60_000);
    await ctx.mockPick(async route => {
      await new Promise(r => setTimeout(r, 14_000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DEFAULT_PICK) }).catch(() => {});
    });
    const btn = page.locator('#form-metaphor button[type=submit]');
    await metaphor(page, 'Как накопить на отпуск');
    await expect(btn).toHaveText('Подбираю…');
    await expect(page.locator('#notice')).toContainText('ИИ не ответил вовремя, поэтому сработал запасной словарь', { timeout: 20_000 });
    await expect(btn).toHaveText('Собрать');
    expect((await items(page)).length).toBeGreaterThan(0);
    expect(appErrors(ctx)).toEqual([]);
  });

  test('кривые ответы ИИ (мусор, чужие id, пусто, не JSON) уходят в словарь и не добавляют новых объектов', async ({ app: page, ctx }) => {
    const bad: [string, (r: import('@playwright/test').Route) => Promise<void> | void][] = [
      ['чужие id', json({ picks: [{ id: 'dragon', variant: 'main' }, { id: '<script>', variant: 'main' }], reason: 'x' })],
      ['пустой picks', json({ picks: [], reason: 'x' })],
      ['не JSON', json('это не json')],
      ['null', json('null')],
      ['picks не массив', json({ picks: 'book' })],
    ];
    for (const [label, h] of bad) {
      await ctx.mockPick(h);
      await metaphor(page, 'Как накопить на отпуск');
      await expect(page.locator('#notice')).toContainText('запасной словарь', { timeout: 5000 });
      const list = await items(page);
      for (const i of list) expect(libraryNames, label).toContain(i.objectId);
      await expect(page.locator('#form-metaphor button[type=submit]')).toBeEnabled();
    }
    expect(appErrors(ctx)).toEqual([]);
  });

  test('ИИ вернул больше допустимого: не больше 5 объектов и 3 главных, без повторов', async ({ app: page, ctx }) => {
    await ctx.mockPick(json({ picks: OBJECTS.map(o => ({ id: o.id, variant: 'main' })).concat([{ id: 'book', variant: 'bg' }]), reason: 'всё' }));
    await metaphor(page, 'всё и сразу');
    const list = await items(page);
    expect(list).toHaveLength(5);
    expect(list.filter(i => i.variant === 'main')).toHaveLength(3);
    expect(new Set(list.map(i => i.objectId)).size).toBe(5);
  });

  test('пустая метафора: запрос не уходит, сообщение об ошибке, композиция не меняется', async ({ app: page, ctx }) => {
    const before = await ids(page);
    await page.locator('#in-metaphor').fill('   ');
    await page.locator('#form-metaphor button[type=submit]').click();
    expect(await noticeText(page)).toBe('Введите метафору или заголовок');
    await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'error');
    expect(ctx.pickCalls.count).toBe(0);
    expect(await ids(page)).toEqual(before);
    await page.locator('#in-names').fill('');
    await page.locator('#form-names button[type=submit]').click();
    expect(await noticeText(page)).toBe('Перечислите компоненты, например: книга, лампа');
    expect(await ids(page)).toEqual(before);
  });

  test('Enter в поле метафоры отправляет форму; нажатие «Собрать» дважды не ломает состояние', async ({ app: page, ctx }) => {
    await page.locator('#in-metaphor').fill('идея');
    await page.locator('#in-metaphor').press('Enter');
    await expect(page.locator('#notice')).toContainText('Подобрал ИИ');
    expect(ctx.pickCalls.count).toBe(1);
    await page.locator('#form-metaphor button[type=submit]').dblclick();
    await expect(page.locator('#form-metaphor button[type=submit]')).toBeEnabled();
    expectNoErrors(ctx);
  });

  test('u059 полный путь: метафора → правка → SVG', async ({ app: page, ctx }) => {
    await ctx.mockPick(json({ picks: [{ id: 'book', variant: 'main' }, { id: 'coin', variant: 'main' }, { id: 'wallet', variant: 'bg' }], reason: 'знания и деньги' }));
    await metaphor(page, 'Как превратить знания в доход');
    expect(await noticeText(page)).toBe('Подобрал ИИ: книга, монета, кошелёк (фон). знания и деньги');
    const list = await items(page);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.length).toBeLessThanOrEqual(4);
    // сначала формат и раскладка (они сбрасывают ручные правки), затем перетаскивание и смена схемы
    await setFormat(page, 'og');
    await setLayout(page, 'title');
    const main = (await items(page)).find(i => i.variant === 'main')!;
    await dragItem(page, main.uid, 30, 25);
    const moved = (await items(page)).find(i => i.id === main.id)!;
    expect(moved.x).not.toBeCloseTo(main.x, 0);
    await setScheme(page, 'Персиковая');
    const { text } = await exportSvg(page);
    const r = await validateExport(page, text, { scheme: SCHEMES.peach, fmt: [1200, 630], count: 3 });
    expect(r.groupTransforms[moved.id]).toBe(moved.transform);
    expectNoErrors(ctx);
  });
});

test.describe('Подбор: список компонентов (словарь)', () => {
  const u060 = async (page: Page, ctx: Ctx, reload: boolean) => {
    await submitNames(page, 'книжка, phone + фоновая лампа и coin');
    expect(await noticeText(page)).toBe('Подобрано по словарю: книга, телефон, лампа (фон), монета. Все компоненты найдены.');
    // reload — обход бага дублирования uid (см. objects.spec.ts, «БАГ uid»): после перезагрузки uid нумеруются заново
    if (reload) await page.reload();
    let list = await items(page);
    expect(list.map(i => i.id).sort()).toEqual(['book-main-1', 'coin-main-1', 'lamp-bg-1', 'phone-main-1']);
    // у лампы «Сделать главным», затем «Сделать фоновым»
    const lamp = list.find(i => i.objectId === 'lamp')!;
    await clickItem(page, lamp.uid);
    await panelBtn(page, 'variant').click();
    expect(await selectedId(page)).toBe('lamp-main-1');
    await panelBtn(page, 'variant').click();
    expect(await selectedId(page)).toBe('lamp-bg-1');
    // телефон: дублировать, выше/ниже, удалить копию
    const phone = (await items(page)).find(i => i.objectId === 'phone')!;
    await clickItem(page, phone.uid);
    await panelBtn(page, 'dup').click();
    expect((await items(page)).filter(i => i.objectId === 'phone')).toHaveLength(2);
    await panelBtn(page, 'front').click();
    await panelBtn(page, 'back').click();
    await panelBtn(page, 'del').click();
    list = await items(page);
    expect(list.filter(i => i.objectId === 'phone')).toHaveLength(1);
    expect(list).toHaveLength(4);
    // своя палитра, оттенок, экспорт
    await page.locator('summary', { hasText: 'Загрузить палитру' }).click();
    await page.locator('#in-palette').fill('#EEEEEE #CCCCCC #AAAAAA #FF0000 #00FF00 #0000FF');
    await page.locator('#btn-palette').click();
    await clickItem(page, (await items(page)).find(i => i.objectId === 'book')!.uid);
    await panelBtn(page, 'tone').click();
    const { text } = await exportSvg(page);
    await validateExport(page, text, {
      count: 4, scheme: { bg1: '#EEEEEE', bg2: '#CCCCCC', bg3: '#AAAAAA', black: '#181817', obj1: '#FF0000', obj2: '#00FF00', obj3: '#0000FF', white: '#FFFFFF' },
    });
    expectNoErrors(ctx);
  };

  test('u060 полный путь: «книжка, phone + фоновая лампа и coin»', async ({ app: page, ctx }) => {
    await u060(page, ctx, false);
  });

  test('u060 тот же путь после перезагрузки страницы (обход бага uid)', async ({ app: page, ctx }) => {
    await u060(page, ctx, true);
  });

  test('u060 опечатка «кнгиа»: либо находится книга, либо честное сообщение, без падения', async ({ app: page, ctx }) => {
    await submitNames(page, 'кнгиа, phone + фоновая лампа и coin');
    const n = await noticeText(page);
    expect(n).toMatch(/^Подобрано по словарю: /);
    const list = await items(page);
    expect(list.length === 4 || (list.length === 3 && /Не нашлось в библиотеке: кнгиа/.test(n))).toBeTruthy();
    expectNoErrors(ctx);
  });

  test('несуществующие компоненты: сообщение об ошибке со списком доступных, композиция не меняется', async ({ app: page }) => {
    const before = await ids(page);
    await submitNames(page, 'дракон, холодильник');
    const n = await noticeText(page);
    expect(n).toContain('Таких объектов в библиотеке нет. Доступны: ');
    for (const o of OBJECTS) expect(n.toLowerCase()).toContain(NAME_BY_ID[o.id].toLowerCase());
    await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'error');
    expect(await ids(page)).toEqual(before);
  });

  test('ограничения подбора: 10 объектов → 5, из них не более 3 главных', async ({ app: page }) => {
    await submitNames(page, OBJECTS.map(o => NAME_BY_ID[o.id]).join(', '));
    const list = await items(page);
    expect(list).toHaveLength(5);
    expect(list.filter(i => i.variant === 'main').length).toBeLessThanOrEqual(3);
    expect(list.filter(i => i.variant === 'main').length).toBeGreaterThanOrEqual(1);
  });

  test('пометки «фон/главный», отрицание «без» и повтор названия', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа (фон), без монеты, книга');
    expect((await ids(page)).sort()).toEqual(['book-main-1', 'lamp-bg-1']);
    await submitNames(page, 'только фоновые: лампа, ручка; книга');
    const list = await items(page);
    expect(list.find(i => i.objectId === 'book')!.variant).toBe('main');
    expect(list.find(i => i.objectId === 'lamp')!.variant).toBe('bg');
  });

  test('XSS и разметка в полях подбора выводятся как текст', async ({ app: page, ctx }) => {
    const dialogs: string[] = [];
    page.on('dialog', d => { dialogs.push(d.message()); void d.dismiss(); });
    await submitNames(page, '<img src=x onerror=alert(1)>, книга');
    await metaphor(page, '<script>alert(1)</script> "><svg onload=alert(2)>');
    await page.waitForTimeout(300);
    expect(dialogs).toEqual([]);
    await expect(page.locator('#notice img, #notice script, #notice svg')).toHaveCount(0);
    expectNoErrors(ctx);
    void pressedLabels;
  });
});
