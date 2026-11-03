import { library } from './library';
import type { Role, Scheme } from './types';

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
const normHex = (v: string) => {
  const m = HEX.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map(ch => ch + ch).join('') : m[1];
  return `#${h.toUpperCase()}`;
};

// HEX-токен целиком: не кусок более длинного числа (#FFFFFF80 — не цвет #FFFF80).
const HEX_TOKEN = /(?<![0-9a-z#])#?(?:[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi;
const MAX_PALETTE = 20_000;

/**
 * Разбор загруженной палитры. Поддерживаются:
 * - JSON: {"name": "...", "bg": [3 HEX], "obj": [3 HEX], "black"?: HEX, "white"?: HEX} (или массив с таким объектом);
 * - текст: 6 HEX подряд (3 цвета фона, затем 3 цвета объектов), можно 8 — с чёрным и белым.
 *   Допустимы подписи и разделители («Фон: #D7CDF5, …»), но не код и разметка.
 * Ошибка — понятный текст для пользователя, а не исключение из глубины кода.
 */
export function parsePalette(input: string, fallbackName: string): { scheme?: Scheme; error?: string } {
  const text = input.trim();
  if (!text) return { error: 'Палитра пустая' };
  if (text.length > MAX_PALETTE) return { error: 'Слишком длинный текст палитры' };
  let bg: string[] = [], obj: string[] = [], black = '#181817', white = '#FFFFFF', name = fallbackName;
  if (text.startsWith('{') || text.startsWith('[')) {
    let json: any;
    try { json = JSON.parse(text); } catch { return { error: 'Не удалось прочитать JSON' }; }
    if (Array.isArray(json)) json = json[0];
    if (!json || typeof json !== 'object') return { error: 'В JSON нужен объект палитры' };
    if (!Array.isArray(json.bg) || !Array.isArray(json.obj)) return { error: 'В JSON нужны массивы "bg" и "obj"' };
    bg = json.bg; obj = json.obj;
    if (json.black !== undefined) black = json.black;
    if (json.white !== undefined) white = json.white;
    // Управляющие символы из имени убираем: имя попадает в комментарий SVG, а с ними файл не разбирается как XML.
    const clean = typeof json.name === 'string' ? json.name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
    if (clean) name = clean.slice(0, 40);
  } else {
    if (/[<>{}[\]"'`=\\]|data:/i.test(text)) return { error: 'В тексте палитры должны быть только цвета HEX и подписи' };
    const all = text.match(HEX_TOKEN) ?? [];
    if (all.length !== 6 && all.length !== 8) return { error: `Нужно 6 или 8 цветов HEX, найдено ${all.length}` };
    bg = all.slice(0, 3); obj = all.slice(3, 6);
    if (all.length === 8) { black = all[6]; white = all[7]; }
  }
  if (bg.length !== 3 || obj.length !== 3) return { error: 'Нужно ровно 3 цвета фона и 3 цвета объектов' };
  const values = [...bg, ...obj, black, white].map(v => (typeof v === 'string' ? normHex(v) : null));
  if (values.some(v => !v)) return { error: 'Есть цвет не в формате HEX (#RRGGBB)' };
  const [bg1, bg2, bg3, obj1, obj2, obj3, b, w] = values as string[];
  // id — все 8 цветов: палитры, которые различаются хоть одним цветом, не затирают друг друга.
  const id = 'custom-' + values.join('').replace(/#/g, '').toLowerCase();
  return { scheme: { id, name, bg1, bg2, bg3, black: b, obj1, obj2, obj3, white: w } };
}

const STORAGE_KEY = 'ochen.customSchemes';

function loadCustom(): Scheme[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(s => s && typeof s.id === 'string' && normHex(s.bg1 ?? '')) : [];
  } catch { return []; }
}

let custom = loadCustom();

export const allSchemes = (): Scheme[] => [...library.schemes, ...custom];
export const getScheme = (id: string): Scheme => allSchemes().find(s => s.id === id) ?? library.schemes[0];

export function addScheme(s: Scheme) {
  custom = [...custom.filter(c => c.id !== s.id), s];
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(custom)); } catch { /* без хранилища — только до перезагрузки */ }
}

export const ROLE_LABELS: Record<Role, string> = {
  bg1: 'Фон 1', bg2: 'Фон 2', bg3: 'Фон 3', black: 'Чёрный',
  obj1: 'Объект 1', obj2: 'Объект 2', obj3: 'Объект 3', white: 'Белый',
};
