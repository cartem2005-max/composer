import { baseSize } from './library';
import { FORMATS } from './render';
import type { FormatId, Instance, LayoutId, Pick, SizeKey } from './types';

export const LAYOUTS: Record<LayoutId, string> = {
  compact: 'Собранно',
  offset: 'Со смещением',
  title: 'Под заголовок',
};

interface Placed { pick: Pick; x: number; y: number; w: number; h: number }

// Доли короткой стороны кадра, которые занимает длинная сторона ведущего объекта (по примерам студии: 55–75 %).
const LEAD = {
  compactMax: 0.84, // «Собранно»: один объект не раздуваем больше этого
  offsetMin: 0.62, // «Со смещением»: ведущий не меньше
  offsetMax: 0.82, // и не больше — иначе от него остаётся один угол
  titleMax: 0.7,
};

/**
 * Автоматическая раскладка. ИИ только выбирает объекты, расстановку считает этот код,
 * поэтому результат предсказуемый и одинаковый при одинаковом вводе.
 *
 * 1. Главные объекты — плотная группа: ведущий в центре, остальные по очереди вперёд и назад вдоль
 *    направления ряда с заметным нахлёстом (35–50 %). Передние чуть ниже, задние чуть выше — как в изометрии.
 * 2. Фоновые объекты прячутся за главными: выше и сбоку, нижняя часть скрыта за ведущим.
 * 3. Один общий масштаб: в «Собранно» и «Под заголовок» группа целиком в зоне, в «Со смещением»
 *    масштаб задаёт ведущий объект (крупный, обрезается краем), центры объектов остаются в кадре.
 *
 * seed — номер варианта для кнопки «Другой вариант». 0 — базовая раскладка; другие номера меняют,
 * какой объект ведущий, зеркалят ряд, меняют нахлёст, глубину и обрезку. Один и тот же seed — всегда тот же результат.
 */
export function autoLayout(picks: Pick[], format: FormatId, layout: LayoutId, size: SizeKey, seed = 0) {
  const v = variation(seed);
  const mains = picks.filter(p => p.variant === 'main');
  const bgs = picks.filter(p => p.variant === 'bg');
  const dims = (p: Pick) => baseSize(p.id, size, p.variant);

  const f = FORMATS[format];
  const zone = targetZone(f.w, f.h, layout);
  // Направление ряда зависит от формы зоны: горизонталь — вправо, вертикаль — вниз, квадрат — по диагонали.
  const ratio = zone.w / zone.h;
  const base = ratio > 1.1 ? { x: 1, y: 0.22 } : ratio < 0.8 ? { x: 0.35, y: 1 } : { x: 0.8, y: 0.6 };
  const dir = { x: base.x * v.mirror, y: base.y };
  const len = Math.hypot(dir.x, dir.y);
  const d = { x: dir.x / len, y: dir.y / len };
  const n = { x: -d.y, y: d.x }; // перпендикуляр, направлен «вниз-вперёд»; «назад» (вверх) — с минусом
  const extent = (w: number, h: number) => Math.abs(d.x) * w + Math.abs(d.y) * h;

  const placed: Placed[] = [];
  const bySize = [...mains].sort((a, b) => area(dims(b)) - area(dims(a)));
  const lead = bySize.length ? v.lead % bySize.length : 0;
  const ordered = [...bySize.slice(lead), ...bySize.slice(0, lead)];
  let headPos = 0, tailPos = 0; // края ряда вдоль направления
  ordered.forEach((p, i) => {
    const { w, h } = dims(p);
    const e = extent(w, h);
    if (i === 0) {
      placed.push({ pick: p, x: 0, y: 0, w, h });
      headPos = e / 2; tailPos = -e / 2;
      return;
    }
    // Нахлёст считается от меньшего из соседей, чтобы мелкий объект не утонул в крупном.
    const overlap = Math.min(e, extent(placed[0].w, placed[0].h)) * v.overlap;
    const forward = i % 2 === 1;
    const t = forward ? headPos - overlap + e / 2 : tailPos + overlap - e / 2;
    if (forward) headPos = t + e / 2; else tailPos = t - e / 2;
    // Ступенька по перпендикуляру: передний объект ниже, задний выше.
    const step = Math.min(h, placed[0].h) * v.stagger * (forward ? 1 : -1);
    placed.push({ pick: p, x: d.x * t + n.x * step, y: d.y * t + n.y * step, w, h });
  });

  // Фоновые — за главными: сдвинуты вверх так, что нижняя часть скрыта, и в сторону от ряда.
  bgs.forEach((p, i) => {
    const { w, h } = dims(p);
    if (!mains.length) { placed.push({ pick: p, x: i * w * 0.8, y: 0, w, h }); return; }
    // Первый фоновый — над ведущим (при трёх главных ровно над ним, иначе чуть назад),
    // второй — над последним главным, в другую сторону.
    const host = placed[i === 0 ? 0 : Math.min(i, mains.length - 1)];
    const side = i === 0 && mains.length >= 3 ? 0 : (i % 2 === 0 ? -1 : 1) * Math.sign(d.x || 1);
    const up = (host.h / 2 + h / 2) * (1 - v.back); // v.back — какая доля фонового скрыта за главным
    const aside = host.w * 0.5 * v.aside * (ratio < 0.8 ? 0.5 : 1); // в узкой зоне — меньше вбок
    placed.push({ pick: p, x: host.x + side * aside, y: host.y - up, w, h });
  });

  if (!placed.length) return { scale: 1, items: [] as Omit<Instance, 'uid'>[] };

  const box = {
    x0: Math.min(...placed.map(p => p.x - p.w / 2)),
    x1: Math.max(...placed.map(p => p.x + p.w / 2)),
    y0: Math.min(...placed.map(p => p.y - p.h / 2)),
    y1: Math.max(...placed.map(p => p.y + p.h / 2)),
  };
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  const fit = Math.min(zone.w / bw, zone.h / bh);
  // Пределы размера — от короткой стороны; в вытянутом кадре объекты чуть крупнее, иначе теряются.
  const short = Math.min(f.w, f.h) * (Math.max(f.w, f.h) > Math.min(f.w, f.h) * 1.2 ? 1.12 : 1);
  // Пределы считаем от самого крупного главного объекта (не от ведущего: при другом seed ведущим может стать мелкий).
  const leadDim = Math.max(...(mains.length ? placed.slice(0, mains.length) : placed).map(p => Math.max(p.w, p.h)));

  let scale: number;
  if (layout === 'offset') {
    // Масштаб от ведущего объекта: крупный, как в примерах; группа может уходить за край.
    const want = (fit * v.offsetScale);
    scale = Math.min(Math.max(want, (short * LEAD.offsetMin) / leadDim), (short * LEAD.offsetMax) / leadDim);
  } else {
    // Группа целиком в зоне; одиночный объект не раздуваем на весь кадр.
    const cap = (short * (layout === 'title' ? LEAD.titleMax : LEAD.compactMax)) / leadDim;
    scale = Math.min(fit * v.fitScale, cap);
  }

  // Точка привязки: в «Со смещением» — ведущий объект (его ставим ближе к углу), иначе — центр группы.
  const cx = layout === 'offset' ? placed[0].x : (box.x0 + box.x1) / 2;
  const cy = layout === 'offset' ? placed[0].y : (box.y0 + box.y1) / 2;
  const shiftX = layout === 'offset' ? f.w * v.offsetX * Math.sign(d.x || 1) : 0;
  const shiftY = layout === 'offset' ? f.h * v.offsetY : 0;

  // Слои: фоновые сзади, главные — по глубине (что ниже на картинке, то ближе).
  const z = [...placed].sort((a, b) =>
    (a.pick.variant === b.pick.variant ? 0 : a.pick.variant === 'bg' ? -1 : 1) || a.y + a.h / 2 - (b.y + b.h / 2));

  const items = z.map(p => ({
    objectId: p.pick.id,
    variant: p.pick.variant,
    tone: 0,
    x: zone.cx + shiftX + (p.x - cx) * scale,
    y: zone.cy + shiftY + (p.y - cy) * scale,
    rotation: 0,
  }));
  // «Со смещением» может обрезать объекты краем, но центр каждого должен остаться в кадре,
  // иначе объект почти не виден. Сдвигаем всю группу целиком — расстояния не меняются.
  if (layout === 'offset') {
    // Если центры разнесены шире кадра, уменьшаем всю группу (и размеры, и расстояния) одним множителем.
    const span = (key: 'x' | 'y') => Math.max(...items.map(i => i[key])) - Math.min(...items.map(i => i[key]));
    const k = Math.min(1, (f.w * 0.8) / Math.max(1, span('x')), (f.h * 0.8) / Math.max(1, span('y')));
    if (k < 1) {
      const gx = items.reduce((s, i) => s + i.x, 0) / items.length, gy = items.reduce((s, i) => s + i.y, 0) / items.length;
      scale *= k;
      for (const i of items) { i.x = gx + (i.x - gx) * k; i.y = gy + (i.y - gy) * k; }
    }
    const fitAxis = (key: 'x' | 'y', size: number) => {
      const lo = Math.min(...items.map(i => i[key])), hi = Math.max(...items.map(i => i[key]));
      const min = size * 0.1, max = size * 0.9;
      const dx = hi - lo > max - min ? (min + max) / 2 - (lo + hi) / 2 : lo < min ? min - lo : hi > max ? max - hi : 0;
      for (const i of items) i[key] += dx;
    };
    fitAxis('x', f.w);
    fitAxis('y', f.h);
    // Верх группы (обычно фоновый объект) стараемся не резать: опускаем, пока центры не упрутся в нижний предел.
    const top = Math.min(...z.map((p, i) => items[i].y - (p.h * scale) / 2));
    const room = f.h * 0.9 - Math.max(...items.map(i => i.y));
    if (top < 0 && room > 0) for (const i of items) i.y += Math.min(-top, room);
  }
  return { scale, items };
}

const area = (d: { w: number; h: number }) => d.w * d.h;

/** Параметры варианта раскладки. seed 0 — базовые значения, остальные — детерминированный разброс. */
function variation(seed: number) {
  if (!seed) {
    return { lead: 0, mirror: 1, overlap: 0.42, stagger: 0.18, back: 0.45, aside: 1, fitScale: 1, offsetScale: 1.4, offsetX: 0.12, offsetY: 0.1 };
  }
  let s = (seed * 2654435761) >>> 0;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return {
    lead: seed,
    mirror: seed % 2 === 1 ? -1 : 1,
    overlap: 0.34 + r() * 0.18, // доля нахлёста соседних главных
    stagger: 0.1 + r() * 0.16, // ступенька вверх-вниз между соседями
    back: 0.38 + r() * 0.17, // доля фонового, скрытая за главным
    aside: 0.7 + r() * 0.5, // насколько фоновый уходит в сторону
    fitScale: 0.92 + r() * 0.08,
    offsetScale: 1.3 + r() * 0.3,
    offsetX: 0.06 + r() * 0.1, // сдвиг группы к углу, долей кадра
    offsetY: 0.04 + r() * 0.12,
  };
}

function targetZone(W: number, H: number, layout: LayoutId) {
  if (layout === 'title') {
    // Место под текст: слева на горизонтали и квадрате, сверху на вертикали.
    if (H > W * 1.2) return zone(W * 0.08, H * 0.42, W * 0.84, H * 0.5);
    return zone(W * 0.47, H * 0.1, W * 0.47, H * 0.8);
  }
  if (layout === 'offset') return zone(0, 0, W, H);
  // «Собранно»: небольшие поля, группа крупная.
  return zone(W * 0.07, H * 0.08, W * 0.86, H * 0.84);
}

const zone = (x: number, y: number, w: number, h: number) => ({ w, h, cx: x + w / 2, cy: y + h / 2 });
