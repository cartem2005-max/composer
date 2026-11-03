import {
  test, expect, items, clearAll, addObject, submitNames, noticeText, exportSvg, validateExport, analyzeSvg, setScheme, dragItem,
  setFormat, setLayout, panelBtn, expectNoErrors, SCHEMES, pressedLabels, LAYOUT_LABEL,
} from './helpers';

test.describe('Дополнительные возможности (вариант раскладки, декор, ссылка, буфер, zip)', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('«Другой вариант» меняет расстановку, не трогает состав, отменяется одним шагом', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа');
    const before = await items(page);
    await page.locator('#btn-variant').click();
    const v1 = await items(page);
    expect(v1.map(i => i.objectId).sort()).toEqual(before.map(i => i.objectId).sort());
    expect(v1.map(i => i.transform)).not.toEqual(before.map(i => i.transform));
    expect(await noticeText(page)).toContain('Раскладка пересобрана');
    await page.locator('#btn-undo').click();
    expect((await items(page)).map(i => i.transform)).toEqual(before.map(i => i.transform));
    // смена раскладки возвращает базовый вариант
    await page.locator('#btn-variant').click();
    await page.locator('#btn-variant').click();
    await page.locator('#seg-layout button', { hasText: LAYOUT_LABEL.compact }).click();
    expect((await items(page)).map(i => i.transform)).toEqual(before.map(i => i.transform));
  });

  test('«Другой вариант» на пустом холсте: сообщение об ошибке', async ({ app: page }) => {
    await clearAll(page);
    await page.locator('#btn-variant').click();
    expect(await noticeText(page)).toBe('Сначала соберите композицию.');
    await expect(page.locator('#notice')).toHaveAttribute('data-kind', 'error');
  });

  test('«Другой вариант» держит центры объектов в кадре для всех форматов и раскладок', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа, монета');
    for (const fmt of ['og', 'square', 'vertical'] as const) for (const layout of ['compact', 'offset', 'title'] as const) {
      await setFormat(page, fmt); await setLayout(page, layout);
      const [W, H] = fmt === 'og' ? [1200, 630] : fmt === 'square' ? [1080, 1080] : [1080, 1920];
      for (let v = 0; v < 4; v++) {
        for (const i of await items(page)) {
          expect(i.x, `${fmt}/${layout}/вариант ${v}`).toBeGreaterThanOrEqual(0); expect(i.x).toBeLessThanOrEqual(W);
          expect(i.y).toBeGreaterThanOrEqual(0); expect(i.y).toBeLessThanOrEqual(H);
        }
        await page.locator('#btn-variant').click();
      }
    }
  });

  test('декор фона: переключатель добавляет/убирает <g id="decor">, экспорт валиден в обоих режимах', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа');
    await expect(page.locator('#in-decor')).toBeChecked();
    const withDecor = await exportSvg(page);
    expect(withDecor.text).toContain('<g id="decor">');
    await validateExport(page, withDecor.text, { scheme: SCHEMES.violet, count: 2 });
    await page.locator('#in-decor').uncheck();
    const without = await exportSvg(page);
    expect(without.text).not.toContain('id="decor"');
    await validateExport(page, without.text, { scheme: SCHEMES.violet, count: 2 });
    await page.locator('#btn-undo').click();
    await expect(page.locator('#in-decor')).toBeChecked();
    // декор следует схеме
    await setScheme(page, 'Бирюзовая');
    await validateExport(page, (await exportSvg(page)).text, { scheme: SCHEMES.teal, count: 2 });
  });

  test('«Поделиться»: ссылка копируется и воспроизводит композицию в чистом браузере', async ({ app: page, ctx, context }) => {
    await submitNames(page, 'книга, телефон, лампа');
    await page.reload();
    await setScheme(page, 'Персиковая');
    await setFormat(page, 'square');
    await dragItem(page, (await items(page)).find(i => i.variant === 'main')!.uid, 30, 30);
    await page.locator('#btn-share').click();
    await expect(page.locator('#notice')).toContainText('Ссылка на композицию скопирована');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toMatch(/#c=[A-Za-z0-9_-]+$/);
    const expected = await items(page);
    const fresh = await context.browser()!.newContext({ baseURL: 'http://localhost:5181', viewport: { width: 1400, height: 900 } });
    const p2 = await fresh.newPage();
    await p2.route('**/api/pick', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"picks":[]}' }));
    await p2.goto(link);
    await p2.locator('#canvas svg').waitFor();
    expect(await noticeText(p2)).toBe('Открыта композиция по ссылке.');
    expect(p2.url()).not.toContain('#c=');
    const got = await items(p2);
    expect(got.map(i => i.id)).toEqual(expected.map(i => i.id));
    for (const [k, g] of got.entries()) {
      expect(g.x).toBeCloseTo(expected[k].x, 0); expect(g.y).toBeCloseTo(expected[k].y, 0);
    }
    expect(await pressedLabels(p2, '#schemes')).toHaveLength(1);
    await expect(p2.locator('#schemes .scheme[aria-pressed=true]')).toContainText('Персиковая');
    await fresh.close();
    expectNoErrors(ctx);
  });

  test('«Поделиться»: своя палитра переезжает вместе со ссылкой; мусорная ссылка не ломает страницу', async ({ app: page, ctx, context }) => {
    await submitNames(page, 'книга, лампа');
    await page.locator('summary', { hasText: 'Загрузить палитру' }).click();
    await page.locator('#in-palette').fill('{"name":"Ссылочная","bg":["#EEEEEE","#CCCCCC","#AAAAAA"],"obj":["#FF0000","#00FF00","#0000FF"]}');
    await page.locator('#btn-palette').click();
    await page.locator('#btn-share').click();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const fresh = await context.browser()!.newContext({ baseURL: 'http://localhost:5181' });
    const p2 = await fresh.newPage();
    await p2.route('**/api/pick', r => r.fulfill({ status: 500, body: '' }));
    await p2.goto(link);
    await expect(p2.locator('#schemes .scheme[aria-pressed=true]')).toContainText('Ссылочная');
    for (const bad of ['#c=!!!', '#c=e30', '#c=' + 'A'.repeat(100), '#c=' + btoa('{"items":[{"objectId":"book","x":"<script>"}]}').replace(/=+$/, '')]) {
      await p2.goto('http://localhost:5181/' + bad);
      await p2.reload();
      await expect(p2.locator('#canvas svg')).toBeVisible();
    }
    await fresh.close();
    expectNoErrors(ctx);
  });

  test('«Копировать для Figma»: в буфер попадает тот же валидный SVG; на пустом холсте — сообщение', async ({ app: page }) => {
    await submitNames(page, 'книга, лампа');
    await page.locator('#btn-figma').click();
    await expect(page.locator('#notice')).toContainText('SVG скопирован');
    const text = (await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'); // буфер Windows отдаёт CRLF
    expect(text).toBe((await exportSvg(page)).text);
    await validateExport(page, text, { scheme: SCHEMES.violet, count: 2 });
    await clearAll(page);
    await page.locator('#btn-figma').click();
    expect(await noticeText(page)).toBe('Композиция пустая.');
  });

  test('«Все форматы (zip)»: архив с тремя SVG; на пустом холсте — сообщение', async ({ app: page }) => {
    await submitNames(page, 'книга, телефон, лампа');
    await setScheme(page, 'Бирюзовая');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-formats').click()]);
    expect(dl.suggestedFilename()).toBe('illustrations-teal.zip');
    const chunks: Buffer[] = [];
    for await (const c of await dl.createReadStream()) chunks.push(Buffer.from(c));
    const zip = Buffer.concat(chunks);
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    const names = zip.toString('latin1');
    for (const f of ['og', 'square', 'vertical']) expect(names).toContain(`illustration-${f}-teal.svg`);
    await clearAll(page);
    await page.locator('#btn-formats').click();
    expect(await noticeText(page)).toBe('Композиция пустая.');
    void analyzeSvg; void addObject; void panelBtn;
  });
});
