import type { ObjectId } from '../types';
import { CATALOG } from './catalog.js';
import { OBJECT_NAMES } from './dictionary.js';

// Названия на других языках и синонимы, которых нет в основном словаре.
const EXTRA_NAMES: Partial<Record<ObjectId, string[]>> = {
  book: ['buch', 'livre', 'libro', 'кітап', 'kitap'],
  phone: ['handy', 'telefon', 'smartphone', 'смартфон', 'тэлефон'],
  coin: ['munze', 'монетк'],
  headphones: ['навушник', 'kopfhorer'],
  lamp: ['lampe', 'лямп', 'фонар', 'светильник', 'торшер'],
  tulips: ['tulpe', 'тюльпан'],
  wallet: ['гаманец', 'гаманц', 'geldborse', 'geldbeutel', 'portemonnaie', 'бумажник'],
  folder: ['ordner', 'mappe', 'тэчк'],
  pen: ['stift', 'kugelschreiber', 'ручечк', 'карандаш'],
};
/** Все основы названий объекта: словарь + синонимы и другие языки. */
export const NAMES = Object.fromEntries(
  CATALOG.map(c => [c.id, [...OBJECT_NAMES[c.id], ...(EXTRA_NAMES[c.id] ?? [])]]),
) as Record<ObjectId, string[]>;
