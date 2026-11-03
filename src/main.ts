import { library, baseSize, getObject, paint, shapeSet, distinctTones } from './library';
import { autoLayout, LAYOUTS } from './layout';
import { pickByNames, pickWithAI } from './match/pick';
import { compositionSvg, FORMATS, instanceTransform, layerId } from './render';
import { addScheme, allSchemes, getScheme, parsePalette, ROLE_LABELS } from './schemes';
import { compositionFromLink, sanitizeComposition, shareLink } from './share';
import { Store } from './state';
import { zipSync, strToU8 } from 'fflate';
import { CANVAS_ROLES, type Composition, type FormatId, type Pick, type PickResult } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE_KEY = 'ochen.composition';


function initialComposition(): Composition {
  // 1. Ссылка «Поделиться» — композиция в адресе страницы.
  const fromLink = compositionFromLink(location.hash);
  if (fromLink) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => notify('Открыта композиция по ссылке.'), 0);
    return fromLink;
  }
  // 2. Последняя композиция в этом браузере.
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    const saved = sanitizeComposition(raw);
    if (saved) {
      if (raw.schemeId !== saved.schemeId) setTimeout(() => notify('Сохранённая палитра не найдена, композиция показана в фиолетовой схеме.'), 0);
      return saved;
    }
  } catch { /* повреждённое сохранение — начинаем с примера */ }
  const base: Composition = { format: 'og', layout: 'compact', size: 'L', schemeId: 'violet', background: 'bg1', scale: 1, items: [] };
  setTimeout(() => notify('Введите заголовок статьи — ИИ подберёт объекты. Или перечислите их сами, или добавьте из библиотеки слева.', 'hint'), 0);
  return applyPicks(base, pickByNames('наушники, фоновые тюльпаны').picks);
}

/** Цвета и повороты объектов по ключу «объект:вид» — при пересборке раскладки ручные правки цвета и поворота сохраняются. */
type Kept = { tone: number; rotation: number };
function applyPicks(c: Composition, picks: Pick[], tones: Map<string, Kept[]> = new Map()): Composition {
  const { scale, items } = autoLayout(picks, c.format, c.layout, c.size, c.seed ?? 0);
  const left = new Map([...tones].map(([k, v]) => [k, [...v]]));
  let uid = 1;
  return {
    ...c, scale,
    items: items.map(it => {
      const kept = left.get(`${it.objectId}:${it.variant}`)?.shift();
      return { ...it, tone: kept?.tone ?? 0, rotation: kept?.rotation ?? 0, uid: uid++ };
    }),
  };
}

function tonesOf(c: Composition) {
  const map = new Map<string, Kept[]>();
  for (const it of c.items) { const k = `${it.objectId}:${it.variant}`; map.set(k, [...(map.get(k) ?? []), { tone: it.tone, rotation: it.rotation }]); }
  return map;
}

const store = new Store(initialComposition());

// ---------- Холст ----------

const canvasEl = $('canvas');
let svgEl: SVGSVGElement | null = null;

function renderCanvas() {
  const c = store.state;
  canvasEl.innerHTML = compositionSvg(c);
  svgEl = canvasEl.querySelector('svg');
  if (!svgEl) return;
  svgEl.removeAttribute('width');
  svgEl.removeAttribute('height');
  svgEl.setAttribute('role', 'img');
  svgEl.setAttribute('aria-label', 'Композиция');
  const f = FORMATS[c.format];
  canvasEl.style.aspectRatio = `${f.w} / ${f.h}`;
  const sel = store.selectedItem;
  if (sel) {
    const { w, h } = shapeSet(sel.objectId, c.size, sel.variant);
    const ui = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    ui.setAttribute('id', 'selection');
    ui.setAttribute('transform', instanceTransform(c, sel));
    ui.innerHTML = `<rect x="-6" y="-6" width="${w + 12}" height="${h + 12}" fill="none" stroke="#2F6BFF" stroke-width="2" stroke-dasharray="6 4" vector-effect="non-scaling-stroke"/>`;
    svgEl.appendChild(ui);
  }
}

function svgPoint(e: PointerEvent) {
  const ctm = svgEl!.getScreenCTM()!.inverse();
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

let drag: { uid: number; dx: number; dy: number; moved: boolean } | null = null;

canvasEl.addEventListener('pointerdown', e => {
  if (!svgEl) return;
  const g = (e.target as Element).closest('[data-uid]');
  if (!g) { store.select(null); return; }
  const uid = Number(g.getAttribute('data-uid'));
  const it = store.state.items.find(i => i.uid === uid);
  if (!it) return;
  if (store.selected !== uid) store.select(uid);
  const p = svgPoint(e);
  drag = { uid, dx: p.x - it.x, dy: p.y - it.y, moved: false };
  canvasEl.setPointerCapture(e.pointerId);
});

canvasEl.addEventListener('pointermove', e => {
  if (!drag || !svgEl) return;
  const p = svgPoint(e);
  if (!drag.moved) { store.checkpoint(); drag.moved = true; }
  const d = drag;
  store.update(c => {
    const it = c.items.find(i => i.uid === d.uid);
    if (it) { const f = FORMATS[c.format]; it.x = clamp(p.x - d.dx, 0, f.w); it.y = clamp(p.y - d.dy, 0, f.h); }
  }, false);
});

const endDrag = () => {
  const moved = drag?.moved;
  drag = null;
  if (moved) store.update(() => {}, false); // одна полная перерисовка панелей и сохранение после жеста
};
canvasEl.addEventListener('pointerup', endDrag);
canvasEl.addEventListener('pointercancel', endDrag);

// ---------- Действия с объектами ----------

const actions = {
  add(objectId: Pick['id'], variant: Pick['variant']) {
    const f = FORMATS[store.state.format];
    // Новый объект — в центр кадра; если там уже стоит другой, сдвигаем лесенкой, чтобы объекты не легли друг на друга.
    let x = f.w / 2, y = f.h / 2;
    for (let step = 0; step < 12 && store.state.items.some(i => Math.abs(i.x - x) < 8 && Math.abs(i.y - y) < 8); step++) {
      x = clamp(x + f.w * 0.06, 0, f.w); y = clamp(y + f.h * 0.06, 0, f.h);
    }
    const item = store.withUid({ objectId, variant, tone: 0, x, y, rotation: 0 });
    store.update(c => {
      // На пустом холсте подбираем общий масштаб так, чтобы объект занял около 60 % короткой стороны кадра.
      // Если на холсте уже есть объекты, масштаб не трогаем: он общий, иначе нарушатся пропорции между объектами.
      if (!c.items.length) {
        const { w, h } = baseSize(objectId, c.size, variant);
        c.scale = Math.min(f.w / w, f.h / h) * 0.6;
      }
      variant === 'bg' ? c.items.unshift(item) : c.items.push(item);
    });
    store.select(item.uid);
  },
  duplicate() {
    const s = store.selectedItem; if (!s) return;
    const copy = store.withUid({ ...s, x: s.x + 40, y: s.y + 30 });
    store.update(c => { c.items.splice(c.items.findIndex(i => i.uid === s.uid) + 1, 0, copy); });
    store.select(copy.uid);
  },
  remove() {
    const s = store.selectedItem; if (!s) return;
    store.update(c => { c.items = c.items.filter(i => i.uid !== s.uid); });
  },
  rotate(deg: number) {
    const s = store.selectedItem; if (!s) return;
    store.update(c => { const it = c.items.find(i => i.uid === s.uid)!; it.rotation = (((it.rotation + deg) % 360) + 360) % 360; });
  },
  setRotation(deg: number) {
    const s = store.selectedItem; if (!s) return;
    store.update(c => { c.items.find(i => i.uid === s.uid)!.rotation = deg; });
  },
  layer(dir: 1 | -1 | 'top' | 'bottom') {
    const s = store.selectedItem; if (!s) return;
    const idx = store.state.items.findIndex(x => x.uid === s.uid), last = store.state.items.length - 1;
    if ((dir === 1 || dir === 'top') && idx === last) return;
    if ((dir === -1 || dir === 'bottom') && idx === 0) return;
    store.update(c => {
      const i = c.items.findIndex(x => x.uid === s.uid);
      const [it] = c.items.splice(i, 1);
      const to = dir === 'top' ? c.items.length : dir === 'bottom' ? 0 : Math.max(0, Math.min(c.items.length, i + dir));
      c.items.splice(to, 0, it);
    });
  },
  toggleVariant() {
    const s = store.selectedItem; if (!s) return;
    store.update(c => { const it = c.items.find(i => i.uid === s.uid)!; it.variant = it.variant === 'main' ? 'bg' : 'main'; it.tone = 0; });
  },
  nextTone() {
    const s = store.selectedItem; if (!s) return;
    store.update(c => {
      const it = c.items.find(i => i.uid === s.uid)!;
      const tones = distinctTones(it.objectId, c.size, it.variant);
      it.tone = tones[(tones.indexOf(it.tone) + 1) % tones.length] ?? 0;
    });
  },
  nudge(dx: number, dy: number) {
    const s = store.selectedItem; if (!s) return;
    store.update(c => { const it = c.items.find(i => i.uid === s.uid)!; const f = FORMATS[c.format]; it.x = clamp(it.x + dx, 0, f.w); it.y = clamp(it.y + dy, 0, f.h); });
  },
};

// ---------- Панели ----------

function seg<T extends string>(el: HTMLElement, options: Record<T, string>, current: T, onPick: (v: T) => void) {
  el.innerHTML = '';
  for (const [value, label] of Object.entries(options) as [T, string][]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(value === current));
    b.onclick = () => onPick(value);
    el.appendChild(b);
  }
}

/** Смена формата или раскладки пересобирает расстановку одним шагом истории — Ctrl+Z вернёт всё как было. */
function relayout(change: (d: Composition) => void) {
  store.update(d => {
    change(d);
    const picks = d.items.map(i => ({ id: i.objectId, variant: i.variant }));
    Object.assign(d, applyPicks(d, picks, tonesOf(d)));
  });
  if (store.state.items.length) notify('Раскладка пересобрана. Предыдущую можно вернуть: Ctrl+Z.');
}

function renderPanels() {
  const c = store.state;
  seg($('seg-format'), Object.fromEntries(Object.entries(FORMATS).map(([k, v]) => [k, v.name])) as Record<FormatId, string>, c.format, v => relayout(d => { d.format = v; }));
  seg($('seg-layout'), LAYOUTS, c.layout, v => relayout(d => { d.layout = v; d.seed = 0; }));
  $<HTMLInputElement>('in-decor').checked = c.decor !== false;
  seg($('seg-size'), { L: 'L — подробнее', S: 'S — проще' }, c.size, v => store.update(d => { d.size = v; }));
  const scheme = getScheme(c.schemeId);
  seg($('seg-bg'), Object.fromEntries(CANVAS_ROLES.map(r => [r, ROLE_LABELS[r]])) as Record<(typeof CANVAS_ROLES)[number], string>, c.background,
    v => store.update(d => { d.background = v; }));
  $('seg-bg').querySelectorAll('button').forEach((b, i) => { b.style.setProperty('--sw', scheme[CANVAS_ROLES[i]]); b.classList.add('swatch-btn'); });

  const scale = $<HTMLInputElement>('in-scale');
  scale.value = String(c.scale);

  const schemesEl = $('schemes');
  schemesEl.innerHTML = '';
  for (const s of allSchemes()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'scheme';
    b.setAttribute('aria-pressed', String(s.id === c.schemeId));
    b.title = s.name;
    b.innerHTML = `<span class="chips">${(['bg1', 'bg2', 'bg3', 'obj1', 'obj2', 'obj3'] as const).map(r => `<i style="background:${s[r]}"></i>`).join('')}</span><span>${escapeHtml(s.name)}</span>`;
    b.onclick = () => store.update(d => { d.schemeId = s.id; });
    schemesEl.appendChild(b);
  }

  const panel = $('object-panel');
  const sel = store.selectedItem;
  const active = document.activeElement as HTMLElement | null;
  if (!sel) { panel.innerHTML = '<p class="hint">Выберите объект на холсте.</p>'; delete panel.dataset.uid; }
  else if (active?.dataset.a === 'rot' && panel.contains(active) && panel.dataset.uid === String(sel.uid)) {
    // Ползунок поворота в фокусе: не пересобираем панель, иначе фокус теряется и стрелки начинают двигать объект.
    panel.querySelector('[data-a=rot]')!.parentElement!.querySelector('span')!.textContent = `Поворот: ${Math.round(sel.rotation)}°`;
  }
  else {
    panel.dataset.uid = String(sel.uid);
    const o = getObject(sel.objectId);
    panel.innerHTML = `
      <p class="obj-title">${o.name} · <span>${layerId(c, sel)}</span></p>
      <div class="row pair">
        <button data-a="variant">${sel.variant === 'main' ? 'Сделать фоновым' : 'Сделать главным'}</button>
        ${(() => { const t = distinctTones(sel.objectId, c.size, sel.variant); return t.length > 1 ? `<button data-a="tone">Другие цвета (${Math.max(0, t.indexOf(sel.tone)) + 1}/${t.length})</button>` : ''; })()}
      </div>
      <label class="field"><span>Поворот: ${Math.round(sel.rotation)}°</span>
        <input type="range" min="0" max="359" step="1" value="${sel.rotation}" data-a="rot" /></label>
      <div class="row quad">
        <button data-a="front" title="]">Выше</button><button data-a="back" title="[">Ниже</button>
        <button data-a="top">Наверх</button><button data-a="bottom">Вниз</button>
      </div>
      <div class="row pair">
        <button data-a="dup" title="Ctrl+D">Дублировать</button>
        <button data-a="del" class="danger" title="Delete">Удалить</button>
      </div>`;
    panel.querySelector<HTMLButtonElement>('[data-a=variant]')!.onclick = actions.toggleVariant;
    const toneBtn = panel.querySelector<HTMLButtonElement>('[data-a=tone]');
    if (toneBtn) toneBtn.onclick = actions.nextTone;
    panel.querySelector<HTMLButtonElement>('[data-a=front]')!.onclick = () => actions.layer(1);
    panel.querySelector<HTMLButtonElement>('[data-a=back]')!.onclick = () => actions.layer(-1);
    panel.querySelector<HTMLButtonElement>('[data-a=top]')!.onclick = () => actions.layer('top');
    panel.querySelector<HTMLButtonElement>('[data-a=bottom]')!.onclick = () => actions.layer('bottom');
    panel.querySelector<HTMLButtonElement>('[data-a=dup]')!.onclick = actions.duplicate;
    panel.querySelector<HTMLButtonElement>('[data-a=del]')!.onclick = actions.remove;
    const rot = panel.querySelector<HTMLInputElement>('[data-a=rot]')!;
    rot.onpointerdown = () => store.checkpoint();
    rot.oninput = () => store.update(d => { d.items.find(i => i.uid === sel.uid)!.rotation = Number(rot.value); }, false);
  }

  $<HTMLButtonElement>('btn-undo').disabled = !store.canUndo;
  $<HTMLButtonElement>('btn-redo').disabled = !store.canRedo;
}

let addAs: Pick['variant'] = 'main';
function renderAddAs() {
  seg($('seg-add'), { main: 'Добавлять главным', bg: 'фоновым' }, addAs, v => { addAs = v; renderAddAs(); renderLibrary(); });
}

function renderLibrary() {
  const el = $('library');
  const scheme = getScheme(store.state.schemeId);
  el.style.setProperty('--tile', scheme.bg1); // подложка карточек — светлый фон текущей схемы
  el.innerHTML = '';
  for (const o of library.objects) {
    const s = o.sizes.S.main;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-item';
    b.title = `${o.name}: клик — ${addAs === 'bg' ? 'фоновый' : 'главный'}, Shift+клик — ${addAs === 'bg' ? 'главный' : 'фоновый'}`;
    const shown = addAs === 'bg' ? o.sizes.S.bg : s;
    b.innerHTML = `<svg viewBox="-10 -10 ${shown.w + 20} ${shown.h + 20}" aria-hidden="true">${paint(shown.markup, scheme, addAs, 0)}</svg><span>${o.name}</span>`;
    b.onclick = e => actions.add(o.id, (addAs === 'bg') !== e.shiftKey ? 'bg' : 'main');
    el.appendChild(b);
  }
}

// ---------- Подбор ----------

function notify(text: string, kind: 'info' | 'error' | 'hint' = 'info') {
  const n = $('notice');
  n.textContent = text;
  n.dataset.kind = kind;
  n.hidden = !text;
}

function applyResult(r: PickResult) {
  if (!r.picks.length) { notify(r.reason, 'error'); return; }
  store.update(d => { d.seed = 0; Object.assign(d, applyPicks(d, r.picks)); });
  store.select(null);
  const names = r.picks.map(p => `${getObject(p.id).name.toLowerCase()}${p.variant === 'bg' ? ' (фон)' : ''}`).join(', ');
  notify(`${r.source === 'ai' ? 'Подобрал ИИ' : 'Подобрано по словарю'}: ${names}. ${r.reason}`);
}

$('form-metaphor').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $<HTMLInputElement>('in-metaphor');
  const btn = (e.target as HTMLFormElement).querySelector('button')!;
  if (!input.value.trim()) { notify('Введите метафору или заголовок', 'error'); return; }
  btn.disabled = true; btn.textContent = 'Подбираю…';
  try { applyResult(await pickWithAI(input.value)); }
  finally { btn.disabled = false; btn.textContent = 'Собрать'; }
});

$('form-names').addEventListener('submit', e => {
  e.preventDefault();
  const input = $<HTMLInputElement>('in-names');
  if (!input.value.trim()) { notify('Перечислите компоненты, например: книга, лампа', 'error'); return; }
  applyResult(pickByNames(input.value));
});

// ---------- Палитра ----------

function applyPalette(text: string) {
  const { scheme, error } = parsePalette(text, `Своя ${allSchemes().length - library.schemes.length + 1}`);
  if (!scheme) { notify(`Палитра не принята: ${error}`, 'error'); return; }
  addScheme(scheme);
  store.update(d => { d.schemeId = scheme.id; });
  notify(`Палитра «${scheme.name}» применена ко всей композиции.`);
}
$('btn-palette').onclick = () => applyPalette($<HTMLTextAreaElement>('in-palette').value);
$<HTMLInputElement>('file-palette').onchange = async e => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 50_000) { notify('Файл палитры слишком большой', 'error'); return; }
  applyPalette(await file.text());
  (e.target as HTMLInputElement).value = '';
};

// ---------- Масштаб, история, экспорт ----------

const scaleInput = $<HTMLInputElement>('in-scale');
scaleInput.onpointerdown = () => store.checkpoint();
scaleInput.oninput = () => {
  const next = Number(scaleInput.value);
  store.update(d => {
    // Масштабируем всю композицию вокруг центра кадра: и размеры, и расстояния.
    const f = FORMATS[d.format];
    const k = next / d.scale;
    for (const it of d.items) { it.x = f.w / 2 + (it.x - f.w / 2) * k; it.y = f.h / 2 + (it.y - f.h / 2) * k; }
    d.scale = next;
  }, false);
};

// Другой вариант той же подборки: следующий номер раскладки. ИИ не вызывается.
$('btn-variant').onclick = () => {
  if (!store.state.items.length) { notify('Сначала соберите композицию.', 'error'); return; }
  relayout(d => { d.seed = (d.seed ?? 0) + 1; });
};
$<HTMLInputElement>('in-decor').onchange = e => store.update(d => { d.decor = (e.target as HTMLInputElement).checked; });

$('btn-undo').onclick = () => store.undo();
$('btn-redo').onclick = () => store.redo();
$('btn-clear').onclick = () => store.update(d => { d.items = []; });

function fileName(ext: string) {
  const c = store.state;
  return `illustration-${c.format}-${getScheme(c.schemeId).id}.${ext}`;
}

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('btn-export').onclick = () => {
  const svg = compositionSvg(store.state, { forExport: true });
  download(new Blob([svg], { type: 'image/svg+xml' }), fileName('svg'));
};

// В буфер обмена — готовый SVG: в Figma он вставляется через Ctrl+V как редактируемые векторы.
$('btn-figma').onclick = async () => {
  if (!store.state.items.length) { notify('Композиция пустая.', 'error'); return; }
  try {
    await navigator.clipboard.writeText(compositionSvg(store.state, { forExport: true }));
    notify('SVG скопирован. В Figma нажмите Ctrl+V — композиция вставится векторами со слоями.');
  } catch {
    notify('Браузер не дал доступ к буферу обмена. Скачайте SVG кнопкой «Скачать SVG».', 'error');
  }
};

// Та же подборка во всех трёх форматах — одним архивом. Схема, размер, цвета объектов и вариант раскладки сохраняются.
$('btn-formats').onclick = () => {
  const c = store.state;
  if (!c.items.length) { notify('Композиция пустая.', 'error'); return; }
  const picks = c.items.map(i => ({ id: i.objectId, variant: i.variant }));
  const files: Record<string, Uint8Array> = {};
  for (const format of Object.keys(FORMATS) as FormatId[]) {
    // Текущий формат кладём как есть на холсте; остальные раскладываем автоматически той же раскладкой.
    const variant = format === c.format ? c : applyPicks({ ...c, format }, picks, tonesOf(c));
    files[`illustration-${format}-${getScheme(c.schemeId).id}.svg`] = strToU8(compositionSvg(variant, { forExport: true }));
  }
  download(new Blob([zipSync(files)], { type: 'application/zip' }), `illustrations-${getScheme(c.schemeId).id}.zip`);
  notify('Скачан архив: 1200×630, квадрат и вертикаль.');
};

$('btn-share').onclick = async () => {
  const link = shareLink(store.state);
  try {
    await navigator.clipboard.writeText(link);
    notify('Ссылка на композицию скопирована — по ней откроется ровно то же самое.');
  } catch {
    notify(`Ссылка: ${link}`);
  }
};

$('btn-png').onclick = () => {
  const f = FORMATS[store.state.format];
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = f.w; cv.height = f.h;
    cv.getContext('2d')!.drawImage(img, 0, 0, f.w, f.h);
    cv.toBlob(b => b && download(b, fileName('png')), 'image/png');
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(compositionSvg(store.state));
};

document.addEventListener('keydown', e => {
  const t = e.target as HTMLElement;
  if (t instanceof Element && t.closest('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  // e.code — физическая клавиша: Ctrl+Z, R, [ и ] работают и на русской раскладке («я», «к», «х», «ъ»).
  if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (mod && e.code === 'KeyY') { e.preventDefault(); store.redo(); return; }
  if (mod && e.code === 'KeyD') e.preventDefault(); // иначе браузер открывает «Добавить в закладки»
  if (!store.selectedItem) return;
  const step = e.shiftKey ? 20 : 4;
  switch (true) {
    case e.key === 'Delete' || e.key === 'Backspace': e.preventDefault(); actions.remove(); break;
    case mod && e.code === 'KeyD': actions.duplicate(); break;
    case e.code === 'KeyR' && !mod: actions.rotate(e.shiftKey ? -15 : 15); break;
    case e.code === 'BracketRight': actions.layer(1); break;
    case e.code === 'BracketLeft': actions.layer(-1); break;
    case e.key === 'ArrowLeft': e.preventDefault(); actions.nudge(-step, 0); break;
    case e.key === 'ArrowRight': e.preventDefault(); actions.nudge(step, 0); break;
    case e.key === 'ArrowUp': e.preventDefault(); actions.nudge(0, -step); break;
    case e.key === 'ArrowDown': e.preventDefault(); actions.nudge(0, step); break;
    case e.key === 'Escape': store.select(null); break;
  }
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

let lastScheme = '';
store.subscribe(() => {
  // Стартовая подсказка уходит после первого действия.
  const n = $('notice');
  if (n.dataset.kind === 'hint') { n.hidden = true; n.textContent = ''; delete n.dataset.kind; }
  renderCanvas();
  // Во время перетаскивания панели и сохранение не трогаем — догонят на отпускании мыши.
  if (drag?.moved) return;
  renderPanels();
  if (store.state.schemeId !== lastScheme) { lastScheme = store.state.schemeId; renderLibrary(); }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(store.state)); } catch { /* без сохранения */ }
});

lastScheme = store.state.schemeId;
renderAddAs();
renderLibrary();
renderCanvas();
renderPanels();
