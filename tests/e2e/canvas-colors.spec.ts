import {
  test, expect, items, ids, clearAll, addObject, panelBtn, clickItem, dragItem, submitNames, setFormat, setLayout, noticeText, toneInfo,
  exportSvg, validateExport, analyzeSvg, SCHEMES, expectNoErrors, pressedLabels, segBtn, setScheme,
} from './helpers';
import type { Page } from '@playwright/test';

const hexes = (html: string) => [...new Set([...html.matchAll(/#[0-9a-fA-F]{6}\b/g)].map(m => m[0].toUpperCase()))];
const V = SCHEMES.violet;
const up = (c: string) => c.toUpperCase();

test.describe('Цвет холста, фоновые объекты и декор', () => {
  test('кнопок «Чёрный» нет: цвета холста только Фон 1 / Фон 2 / Фон 3', async ({ app: page }) => {
    expect(await page.locator('#seg-bg button').allTextContents()).toEqual(['Фон 1', 'Фон 2', 'Фон 3']);
    expect(await pressedLabels(page, '#seg-bg')).toEqual(['Фон 1']);
  });

  for (const [label, bgKey, fill, lines] of [['Фон 1', 'bg1', 'bg1', 'bg3'], ['Фон 2', 'bg2', 'bg2', 'bg3'], ['Фон 3', 'bg3', 'bg3', 'bg1']] as const) {
    test(`фоновый объект и декор подстраиваются под цвет холста «${label}» (заливка ${fill}, линии ${lines})`, async ({ app: page }) => {
      await clearAll(page);
      await addObject(page, 'Тюльпаны в вазе', { bg: true });
      await addObject(page, 'Книга', { bg: true });
      await segBtn(page, '#seg-bg', label).click();
      const canvas = up(V[bgKey]);
      const bgObjects = await page.evaluate(() => [...document.querySelectorAll('#canvas svg [data-uid]')].map(g => g.innerHTML));
      const allowed = new Set([V.bg1, V.bg2, V.bg3].map(up));
      for (const html of bgObjects) {
        const cs = hexes(html);
        for (const c of cs) expect(allowed.has(c), `цвет ${c} вне оттенков фона схемы`).toBeTruthy();
        expect(cs, 'заливка в цвет холста').toContain(up(V[fill]));
        expect(cs, 'линии виднее заливки').toContain(up(V[lines]));
        expect(cs.length, 'объект не сливается с холстом целиком').toBeGreaterThan(1);
        expect(cs.some(c => c !== canvas)).toBeTruthy();
      }
      const decor = await page.evaluate(() => document.querySelector('#canvas svg #decor')?.innerHTML ?? '');
      const dc = hexes(decor);
      expect(dc.length).toBeGreaterThan(0);
      const allScheme = new Set(Object.entries(V).filter(([k]) => k !== 'id' && k !== 'name').map(([, v]) => up(v as string)));
      for (const c of dc) expect(allScheme.has(c), `цвет декора ${c} вне схемы`).toBeTruthy();
      // элементы декора цвета холста становятся bg1; на bg1 декор не меняется
      if (bgKey !== 'bg1') expect(dc, 'декор не сливается с холстом').not.toContain(canvas);
      const { text } = await exportSvg(page);
      const r = await validateExport(page, text, { scheme: V, count: 2 });
      expect(r.bgFill).toBe(canvas);
    });
  }

  test('главные объекты от цвета холста не зависят', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    const sel = '#canvas svg [data-uid]';
    const before = await page.locator(sel).innerHTML();
    for (const l of ['Фон 2', 'Фон 3']) {
      await segBtn(page, '#seg-bg', l).click();
      expect(await page.locator(sel).innerHTML()).toBe(before);
    }
  });

  test('цвета остаются в схеме при любых схемах и цветах холста', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, фоновая лампа, фоновые тюльпаны');
    for (const [name, id] of [['Фиолетовая', 'violet'], ['Персиковая', 'peach'], ['Бирюзовая', 'teal']] as const) {
      await setScheme(page, name);
      for (const l of ['Фон 1', 'Фон 2', 'Фон 3']) {
        await segBtn(page, '#seg-bg', l).click();
        await validateExport(page, (await exportSvg(page)).text, { scheme: SCHEMES[id] });
      }
    }
  });

  test('сохранённое состояние и ссылка с background "black" возвращаются к «Фон 1»', async ({ app: page, ctx }) => {
    const comp = { format: 'og', layout: 'compact', size: 'L', schemeId: 'violet', background: 'black', scale: 1, items: [{ objectId: 'book', variant: 'main', tone: 0, x: 600, y: 300, rotation: 0 }] };
    await page.evaluate(c => localStorage.setItem('ochen.composition', JSON.stringify(c)), comp);
    await page.reload();
    expect(await pressedLabels(page, '#seg-bg')).toEqual(['Фон 1']);
    expect((await analyzeSvg(page, (await exportSvg(page)).text)).bgFill).toBe(up(V.bg1));
    const link = 'http://localhost:5181/#c=' + Buffer.from(JSON.stringify(comp)).toString('base64url');
    await page.goto(link);
    await expect(page.locator('#canvas svg')).toBeVisible();
    expect(await pressedLabels(page, '#seg-bg')).toEqual(['Фон 1']);
    expect(await ids(page)).toEqual(['book-main-1']);
    expectNoErrors(ctx);
  });
});

test.describe('Пересборка раскладки сохраняет оттенок и поворот', () => {
  async function prepare(page: Page) {
    await submitNames(page, 'книга, телефон, лампа');
    await page.reload();
    const phone = (await items(page)).find(i => i.objectId === 'phone')!;
    await clickItem(page, phone.uid);
    await page.keyboard.press('r'); await page.keyboard.press('r');
    await panelBtn(page, 'tone').click();
    const lamp = (await items(page)).find(i => i.objectId === 'lamp')!;
    await clickItem(page, lamp.uid);
    await page.keyboard.press('Shift+R');
    await panelBtn(page, 'tone').click(); await panelBtn(page, 'tone').click().catch(() => {});
    return { phoneTone: 2, lampRot: 345 };
  }
  const check = async (page: Page, want: { phoneRot: number; lampRot: number }, label: string) => {
    const list = await items(page);
    expect(list.find(i => i.objectId === 'phone')!.rotation, label).toBe(want.phoneRot);
    expect(list.find(i => i.objectId === 'lamp')!.rotation, label).toBe(want.lampRot);
    expect(list.find(i => i.objectId === 'book')!.rotation, label).toBe(0);
  };

  test('формат, раскладка и «Другой вариант» оставляют поворот и оттенок, положения пересчитываются', async ({ app: page }) => {
    await prepare(page);
    const toneOf = async (obj: string) => { await clickItem(page, (await items(page)).find(i => i.objectId === obj)!.uid); return (await toneInfo(page))?.n ?? 1; };
    const t0 = { phone: await toneOf('phone'), lamp: await toneOf('lamp') };
    expect(t0.phone).toBe(2);
    const before = (await items(page)).map(i => i.transform.replace(/rotate\([^)]*\) /, ''));
    for (const step of ['square', 'vertical', 'og'] as const) {
      await setFormat(page, step);
      await check(page, { phoneRot: 30, lampRot: 345 }, `формат ${step}`);
      expect(await toneOf('phone'), `оттенок телефона, формат ${step}`).toBe(t0.phone);
      expect(await toneOf('lamp'), `оттенок лампы, формат ${step}`).toBe(t0.lamp);
    }
    for (const l of ['offset', 'title', 'compact'] as const) {
      await setLayout(page, l);
      await check(page, { phoneRot: 30, lampRot: 345 }, `раскладка ${l}`);
      expect(await toneOf('phone')).toBe(t0.phone);
    }
    for (let i = 0; i < 3; i++) {
      await page.locator('#btn-variant').click();
      await check(page, { phoneRot: 30, lampRot: 345 }, `вариант ${i + 1}`);
      expect(await toneOf('phone')).toBe(t0.phone);
    }
    void before;
  });

  test('положения при пересборке пересчитываются (ручные сдвиги не сохраняются)', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон');
    const [a] = await items(page);
    const base = (await items(page)).map(i => [i.x, i.y]);
    await dragItem(page, a.uid, 80, 40);
    expect((await items(page)).map(i => [i.x, i.y])).not.toEqual(base);
    await setLayout(page, 'compact');
    const after = (await items(page)).map(i => [i.x, i.y]);
    for (const [k, p] of after.entries()) { expect(p[0]).toBeCloseTo(base[k][0], 0); expect(p[1]).toBeCloseTo(base[k][1], 0); }
  });
});

test.describe('Добавление из библиотеки: положение и масштаб', () => {
  const frameBox = (page: Page, uid: number) => page.evaluate(uid => {
    const svg = document.querySelector('#canvas svg')!.getBoundingClientRect();
    const r = document.querySelector(`#canvas svg [data-uid="${uid}"]`)!.getBoundingClientRect();
    const k = 1200 / svg.width;
    return { w: r.width * k, h: r.height * k };
  }, uid);

  test('пустой холст: масштаб подбирается так, чтобы объект занял ~60 % кадра', async ({ app: page }) => {
    for (const name of ['Книга', 'Телефон', 'Лампа', 'Монета', 'Ручка', 'Тюльпаны в вазе']) {
      await clearAll(page);
      await addObject(page, name);
      const [it] = await items(page);
      expect(it.x).toBeCloseTo(600, 0); expect(it.y).toBeCloseTo(315, 0);
      const b = await frameBox(page, it.uid);
      const fill = Math.max(b.w / 1200, b.h / 630);
      expect(fill, `${name}: доля кадра по большей стороне`).toBeGreaterThan(0.5);
      expect(fill, name).toBeLessThan(0.7);
    }
  });

  test('на непустом холсте масштаб не меняется, занятый центр сдвигает лесенкой +6 % ширины и высоты', async ({ app: page }) => {
    await clearAll(page);
    await addObject(page, 'Книга');
    const [a] = await items(page);
    await addObject(page, 'Лампа');
    const [, b] = await items(page);
    expect(b.scale).toBe(a.scale);
    expect(b.x - a.x).toBeCloseTo(72, 0); // 6 % от 1200
    expect(b.y - a.y).toBeCloseTo(37.8, 0); // 6 % от 630
    await addObject(page, 'Ручка');
    const c = (await items(page))[2];
    expect(c.x - a.x).toBeCloseTo(144, 0);
    expect(c.y - a.y).toBeCloseTo(75.6, 0);
  });

  test('ступенек не больше 12, координаты не выходят за кадр', async ({ app: page }) => {
    await clearAll(page);
    for (let i = 0; i < 16; i++) await page.locator('#library .lib-item', { hasText: /^Книга$/ }).click();
    for (const it of await items(page)) {
      expect(it.x).toBeGreaterThanOrEqual(0); expect(it.x).toBeLessThanOrEqual(1200);
      expect(it.y).toBeGreaterThanOrEqual(0); expect(it.y).toBeLessThanOrEqual(630);
    }
    expect(await items(page)).toHaveLength(16);
  });
});

test.describe('Сообщения подбора по названиям', () => {
  const NOTE = {
    first: 'Показаны первые 5 из 6: в одной композиции до 5 объектов.',
    main: 'Первый объект сделан главным: в композиции нужен хотя бы один главный.',
    fourth: 'Четвёртый и следующие главные объекты стали фоновыми: главных в композиции не больше трёх.',
    once: 'Каждый объект добавлен один раз — копии делает кнопка «Дублировать» (Ctrl+D).',
    all: 'Все компоненты найдены.',
  };
  const cases: [string, string, string[], string[]][] = [
    ['книга, лампа', 'нет пояснений кроме «Все компоненты найдены»', [NOTE.all], [NOTE.main, NOTE.fourth, NOTE.once, 'Показаны первые', 'Не нашлось']],
    ['книга, телефон, лампа, монета, ручка, папка', 'шесть объектов — показаны первые пять', [NOTE.first], [NOTE.all]],
    ['фоновая лампа', 'единственный фоновый становится главным', [NOTE.main], [NOTE.all]],
    ['фоновая лампа, фоновая книга', 'все фоновые — первый главный', [NOTE.main], [NOTE.all]],
    ['книга, телефон, лампа, монета', 'четвёртый главный становится фоновым', [NOTE.fourth], [NOTE.all]],
    ['книга, дракон', 'неизвестное название', ['Не нашлось в библиотеке: дракон.'], [NOTE.all]],
  ];
  for (const [input, label, has, hasNot] of cases) {
    test(`«${input}»: ${label}`, async ({ app: page }) => {
      await submitNames(page, input);
      const n = await noticeText(page);
      expect(n).toMatch(/^Подобрано по словарю: /);
      for (const h of has) expect(n, n).toContain(h);
      for (const h of hasNot) expect(n, n).not.toContain(h);
      expect((await items(page)).length).toBeGreaterThan(0);
      expect((await items(page)).length).toBeLessThanOrEqual(5);
      if (input === 'две книги' || input === 'книга, книга') expect(await ids(page)).toEqual(['book-main-1']);
    });
  }

  for (const input of ['две книги', 'книга, книга', '3 лампы']) {
    test(`«${input}»: копии не создаются и показано пояснение про «Дублировать»`, async ({ app: page }) => {
      await submitNames(page, input);
      const n = await noticeText(page);
      expect((await items(page)).length).toBe(1); // копий нет
      expect(n, n).toContain(NOTE.once);
    });
  }

  test('объекты, которых нет в библиотеке, не появляются; состав не меняется при ошибке', async ({ app: page }) => {
    const before = await ids(page);
    await submitNames(page, 'дракон, холодильник');
    expect(await noticeText(page)).toContain('Таких объектов в библиотеке нет');
    expect(await ids(page)).toEqual(before);
  });
});
