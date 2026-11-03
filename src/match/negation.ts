import type { ObjectId } from '../types';
import { NAMES } from './names.js';
import { normalize, wordsOf } from './text.js';

// Слова, которые при отрицании означают объект, хотя не называют его прямо: «не в деньгах», «без гаджетов».
const IMPLIED: [string[], ObjectId[]][] = [
  [['деньг', 'денеж', 'бюджет', 'наличн', 'money', 'cash'], ['coin', 'wallet']],
  [['гаджет', 'смартфон', 'экран', 'соцсет', 'чат', 'мессенджер', 'уведомлен', 'интернет', 'приложени'], ['phone']],
  [['учебник', 'книг', 'книжк'], ['book']],
  [['музык'], ['headphones']],
  [['бумаг', 'бумажк', 'бумажн', 'документ', 'квитанц', 'paperwork'], ['folder']],
  [['цветов', 'цветы', 'цветочк', 'букет', 'flower'], ['tulips']],
];

const STARTERS = new Set(['без', 'вместо', 'кроме', 'минус', 'ноль', 'никаких', 'without', 'instead']);
// «не про», «не в», «не о», «не нужен» — отрицание темы. Просто «не» («не звоните») темой не считаем.
const NOT_FOLLOWERS = new Set(['про', 'в', 'о', 'об', 'нужен', 'нужна', 'нужно', 'нужны', 'надо', 'about']);
// После «без X» эти слова делают отрицание двойным: «без X не обойтись», «без X никуда».
// «Без бумажки ты букашка», «без телефона ты как без рук» — обращение «ты/вы» тоже значит, что X нужен.
const DOUBLE_AFTER = new Set(['не', 'никуда', 'никак', 'нельзя', 'невозможно', 'ни', 'нет', 'ты', 'вы', 'cannot', 'cant']);
// Перед «без X»: «Никуда без папки», «Нельзя без наушников», «Ни шагу без кошелька», «can't … without a lamp».
const DOUBLE_BEFORE = new Set(['никуда', 'нельзя', 'ни', 'никак', 'невозможно', 'cannot', 'cant', 'never']);

function objectsOf(word: string[]): ObjectId[] {
  for (const [stems, ids] of IMPLIED) if (word.some(w => stems.some(s => w.startsWith(s)))) return ids;
  for (const [id, stems] of Object.entries(NAMES) as [ObjectId, string[]][])
    if (word.some(w => stems.some(s => (/^[a-z]{1,3}$/.test(s) ? w === s : w.startsWith(s))))) return [id];
  return [];
}

/**
 * Объекты, которые фраза отрицает: «Отпуск без телефона», «Это не про деньги», «Не пазл, а конструктор»,
 * «Мы отказались от бумажных папок», «Phone-free выходные», «Ни бумаг, ни звонков».
 * Двойное отрицание не считается — там объект как раз главный: «Без договора никуда», «Ни дня без книги»,
 * «Никуда без папки», «Без ручки — как без рук», «Кроме ручки, ничего не понадобится».
 */
export function negatedObjects(text: string): ObjectId[] {
  const out = new Set<ObjectId>();
  const t = normalize(text);
  // «Без X — как без рук», «ничего … кроме X»: X обязателен, отрицаний во фразе не ищем.
  const essential = /без\s.+как\s+без\s/.test(t) || /ничего.*кроме|кроме.*ничего/.test(t);
  // Отрицание действует внутри части фразы: «Неделя без кошелька: живу на телефоне» — телефон не отрицается.
  if (!essential) for (const clause of text.split(/[:;,.!?()«»"—–]|\s-\s/)) negatedIn(wordsOf(clause), out);
  const add = (word: string) => objectsOf([word]).forEach(id => out.add(id));
  // «Не пазл, а конструктор» — замена: первый объект отрицается.
  for (const m of t.matchAll(/(?:^|[\s:;—–-])не\s+([a-zа-я]+)[^,]{0,20},\s*а\s/g)) add(m[1]);
  // «на монетах, а не в приложении» — отрицается то, что после «а не».
  for (const m of t.matchAll(/,\s*а\s+не\s+(?:в|на|во|с)?\s*([a-zа-я]+)/g)) add(m[1]);
  // «Ни бумаг, ни звонков»
  for (const m of t.matchAll(/(?:^|\s)ни\s+([a-zа-я]+)\s*,?\s*ни\s+([a-zа-я]+)/g)) { add(m[1]); add(m[2]); }
  // «Phone-free выходные» — только через дефис: в «lamps + free shipping» лампы не отрицаются.
  for (const m of t.matchAll(/([a-zа-я]+)-free\b/g)) add(m[1]);
  // Объект, который в другой части фразы назван прямо, остаётся: «Отказ от наличных: что будет с монетами».
  const clauses = text.split(/[:;.!?—–]|\s-\s/);
  for (const id of [...out]) {
    const named = clauses.some(cl => !/(без|вместо|кроме|минус|ноль|никаких|отказ|забуд|(^|\s)не\s|(^|\s)ни\s|free|without|no more)/i.test(cl)
      && wordsOf(cl).some(v => v.some(w => NAMES[id].some(s => (/^[a-z]{1,3}$/.test(s) ? w === s : w.startsWith(s))))));
    if (named) out.delete(id);
  }
  return [...out];
}

function negatedIn(ws: string[][], out: Set<ObjectId>) {
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i][0];
    const next = ws[i + 1]?.[0] ?? '';
    let target = -1;
    if (STARTERS.has(w)) target = i + 1;
    else if ((w === 'не' || w === 'not') && NOT_FOLLOWERS.has(next)) target = i + 2;
    else if (w.startsWith('отказ') && next === 'от') target = i + 2;          // «отказались от», «отказ от»
    else if (w.startsWith('забуд') && ['про', 'о', 'об'].includes(next)) target = i + 2; // «забудьте про»
    else if ((w === 'no' && next === 'more') || (w === 'free' && next === 'of')) target = i + 2;
    else if (w === 'больше' && next === 'никаких') target = i + 2;
    if (target < 0 || !ws[target]) continue;
    // «без пустого кошелька», «без лишних бумаг» — отрицается признак, а не сам объект.
    if (['пуст', 'лишн'].some(s => ws[target][0].startsWith(s))) continue;
    // Двойное отрицание: слово перед «без» («ни шагу без», «никуда без») или после объекта («без X не обойтись»).
    if (w === 'без' && ws.slice(Math.max(0, i - 3), i).some(v => DOUBLE_BEFORE.has(v[0]))) continue;
    // В английском отрицание стоит дальше: «You can't run a home office without a lamp».
    if (w === 'without' && ws.slice(0, i).some((v, k) => DOUBLE_BEFORE.has(v[0]) || (v[0] === 'can' && ws[k + 1]?.[0] === 't') || v[0] === 'don' || v[0] === 'won')) continue;
    // «без X … не …»: если фраза начинается с «без X», двойное отрицание ищем до конца её части
    // («Без наушников в нашем колл-центре смену не отработать»), иначе — в ближайших словах.
    const reach = w === 'без' && i === 0 ? ws.length : target + 4;
    if (ws.slice(target + 1, reach).some(v => DOUBLE_AFTER.has(v[0]))) continue;
    // Отрицание тянется на перечисление: «без ноутбука и рабочих чатов», «без бумажных документов».
    for (let j = target; j < Math.min(ws.length, target + 5); j++) objectsOf(ws[j]).forEach(id => out.add(id));
  }
}
