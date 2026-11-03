import { isObjectId, library, toneCount } from './library';
import { LAYOUTS } from './layout';
import { FORMATS } from './render';
import { addScheme, getScheme, parsePalette } from './schemes';
import { BG_ROLES, type Composition, type FormatId, type Instance, type LayoutId, type Scheme } from './types';

const MAX_ITEMS = 40;
const num = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

/**
 * Проверка композиции из внешнего источника (ссылка «Поделиться», сохранение в браузере).
 * Всё, что не похоже на композицию, отбрасывается, числа ограничиваются разумными пределами.
 * Возвращает null, если восстановить нечего.
 */
export function sanitizeComposition(raw: any): Composition | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const format: FormatId = FORMATS[raw.format as FormatId] ? raw.format : 'og';
  const f = FORMATS[format];
  const items: Instance[] = [];
  for (const it of raw.items.slice(0, MAX_ITEMS)) {
    if (!it || !isObjectId(it.objectId)) continue;
    const variant = it.variant === 'bg' ? 'bg' : 'main';
    items.push({
      uid: items.length + 1,
      objectId: it.objectId,
      variant,
      tone: Math.floor(num(it.tone, 0, toneCount(variant) - 1, 0)),
      x: num(it.x, 0, f.w, f.w / 2),
      y: num(it.y, 0, f.h, f.h / 2),
      rotation: num(it.rotation, 0, 359.99, 0),
    });
  }
  return {
    format,
    layout: LAYOUTS[raw.layout as LayoutId] ? raw.layout : 'compact',
    size: raw.size === 'S' ? 'S' : 'L',
    schemeId: typeof raw.schemeId === 'string' && getScheme(raw.schemeId).id === raw.schemeId ? raw.schemeId : library.schemes[0].id,
    background: (BG_ROLES as readonly string[]).includes(raw.background) ? raw.background : 'bg1',
    scale: num(raw.scale, 0.05, 3, 1),
    items,
    decor: raw.decor !== false,
    seed: Math.floor(num(raw.seed, 0, 1e6, 0)),
  };
}

// Ссылка: композиция (и своя палитра, если она выбрана) сжимается в JSON → base64url в адресе после #c=
const toB64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)));

export function shareLink(c: Composition): string {
  const scheme = getScheme(c.schemeId);
  const custom = library.schemes.some(s => s.id === scheme.id) ? undefined : scheme;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const data = {
    ...c,
    scale: Math.round(c.scale * 1e4) / 1e4,
    items: c.items.map(({ uid: _uid, ...it }) => ({ ...it, x: r1(it.x), y: r1(it.y), rotation: r1(it.rotation) })),
    palette: custom && { name: custom.name, colors: [custom.bg1, custom.bg2, custom.bg3, custom.obj1, custom.obj2, custom.obj3, custom.black, custom.white] },
  };
  return `${location.origin}${location.pathname}#c=${toB64(JSON.stringify(data))}`;
}

/** Композиция из адреса страницы, если она там есть. Своя палитра из ссылки проходит ту же проверку, что и загрузка палитры. */
export function compositionFromLink(hash: string): Composition | null {
  const m = /^#c=([A-Za-z0-9_-]{1,20000})$/.exec(hash);
  if (!m) return null;
  try {
    const raw = JSON.parse(fromB64(m[1]));
    if (raw?.palette && Array.isArray(raw.palette.colors)) {
      const { scheme } = parsePalette(raw.palette.colors.slice(0, 8).join(' '), String(raw.palette.name ?? 'Из ссылки').slice(0, 40));
      if (scheme) { addScheme({ ...scheme, name: String(raw.palette.name ?? scheme.name).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40) || scheme.name } as Scheme); raw.schemeId = scheme.id; }
    }
    return sanitizeComposition(raw);
  } catch {
    return null;
  }
}
