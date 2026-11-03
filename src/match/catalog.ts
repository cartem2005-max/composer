import type { ObjectId, Pick } from '../types';

/** Каталог для ИИ и проверки ответа. Без геометрии, чтобы серверная функция оставалась лёгкой. */
export const CATALOG: { id: ObjectId; name: string; meaning: string }[] = [
  { id: 'book', name: 'Книга', meaning: 'книги и чтение, учёба, знания, литература, истории' },
  { id: 'phone', name: 'Телефон', meaning: 'связь, приложения, соцсети, онлайн-сервисы, уведомления' },
  { id: 'puzzle', name: 'Пазл', meaning: 'решение задачи, командная работа, интеграция, стратегия' },
  { id: 'coin', name: 'Монета', meaning: 'деньги, доход, экономия, цена, инвестиции' },
  { id: 'headphones', name: 'Наушники', meaning: 'музыка, подкасты, аудио, звук, тишина и концентрация, колл-центр' },
  { id: 'lamp', name: 'Лампа', meaning: 'идея, вдохновение, рабочее место, учёба допоздна' },
  { id: 'tulips', name: 'Тюльпаны в вазе', meaning: 'праздник, подарок, весна, уют, благодарность, забота' },
  { id: 'wallet', name: 'Кошелёк', meaning: 'бюджет, покупки, накопления, расходы, зарплата' },
  { id: 'folder', name: 'Папка', meaning: 'документы, проекты, архив, отчёты, порядок в делах' },
  { id: 'pen', name: 'Ручка', meaning: 'подпись, договор, заметки, письмо, план' },
];

const IDS = new Set<string>(CATALOG.map(c => c.id));
export const MAX_PICKS = 5;
export const MAX_MAIN = 3;

/**
 * Приводит любой ответ (ИИ или словаря) к допустимому виду:
 * только объекты из библиотеки, без повторов, не больше 5 объектов и 3 главных, хотя бы один главный.
 * Всё, чего нет в библиотеке, отбрасывается — так новый объект появиться не может.
 */
export function sanitizePicks(raw: unknown): Pick[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const item of raw) {
    const id = typeof item === 'string' ? item : item && typeof item === 'object' ? (item as any).id : undefined;
    if (typeof id !== 'string' || !IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    const variant = item && typeof item === 'object' && (item as any).variant === 'bg' ? 'bg' : 'main';
    out.push({ id: id as ObjectId, variant });
    if (out.length === MAX_PICKS) break;
  }
  let mains = 0;
  for (const p of out) if (p.variant === 'main' && ++mains > MAX_MAIN) p.variant = 'bg';
  if (out.length && !out.some(p => p.variant === 'main')) out[0].variant = 'main';
  return out;
}

export const MAX_INPUT = 300;
/** Чистит ввод: обрезает длину и убирает управляющие символы. */
export const cleanInput = (text: unknown) =>
  Array.from(
    (typeof text === 'string' ? text : '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      // Одиночные половинки суррогатных пар и невидимые символы-теги ломают JSON и обманывают фильтры.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
      .replace(/[​-‏⁠﻿‪-‮⁦-⁩]|[\u{E0000}-\u{E007F}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, MAX_INPUT).join('').trim();
