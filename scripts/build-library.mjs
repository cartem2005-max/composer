// Собирает библиотеку объектов из SVG, выгруженных из Figma (фреймы «Размер L» и «Размер S»).
//
// Figma отдаёт фрейм плоским списком фигур без групп и имён. Скрипт:
// 1. читает фигуры по порядку документа и считает рамку (bbox) каждой;
// 2. склеивает соседние пересекающиеся фигуры в объекты;
// 3. делит объекты на «главные» и «фоновые» по подписям-заголовкам фрейма;
// 4. даёт объектам имена по положению на листе (scripts/objects.config.json);
// 5. заменяет каждый HEX на роль цвета (bg1..bg3, black, obj1..obj3, white).
//    Цвет не из схемы — ошибка сборки: так нарушение схемы не пройдёт молча.
// Результат: src/library.generated.json. Геометрия фигур копируется как есть, без изменений.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgPathBbox } from 'svg-path-bbox';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'scripts/objects.config.json'), 'utf8'));

// Роли цветов задаются по исходной схеме (фиолетовая), в которой нарисована библиотека.
const SOURCE_ROLES = {
  '#D7CDF5': 'bg1', '#AA9BF0': 'bg2', '#7864D7': 'bg3', '#181817': 'black',
  '#F9ECB0': 'obj1', '#F9A3AA': 'obj2', '#FFE3E1': 'obj3', '#FFFFFF': 'white',
  WHITE: 'white',
};

// Скрипт рассчитан на плоскую выгрузку фрейма из Figma (path/rect с заливкой и обводкой).
// Всё, что он не умеет переносить без искажений, — повод остановить сборку, а не тихо потерять часть рисунка.
const UNSUPPORTED = /<(mask|use|image|filter|linearGradient|radialGradient|pattern|text|foreignObject)\b/;

function readElements(file) {
  let svg = fs.readFileSync(file, 'utf8');
  const bad = UNSUPPORTED.exec(svg);
  if (bad) throw new Error(`${path.basename(file)}: элемент <${bad[1]}> не поддерживается — выгрузите фрейм без масок, градиентов и растров`);
  svg = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/<\/?g\b[^>]*>/g, '');
  const elements = [];
  const re = /<(path|rect|circle|ellipse)\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(svg))) {
    const [raw, tag, attrs] = m;
    elements.push({ index: elements.length, raw, tag, attrs, bbox: bboxOf(tag, attrs) });
  }
  return elements;
}

function attr(attrs, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
}

function bboxOf(tag, attrs) {
  if (tag === 'path') return svgPathBbox(attr(attrs, 'd'));
  if (tag === 'rect') {
    const t = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(attr(attrs, 'transform') || '');
    const x = +(attr(attrs, 'x') || 0) + (t ? +t[1] : 0);
    const y = +(attr(attrs, 'y') || 0) + (t ? +t[2] : 0);
    return [x, y, x + +attr(attrs, 'width'), y + +attr(attrs, 'height')];
  }
  throw new Error(`Неожиданный элемент <${tag}>`);
}

const overlaps = (a, b, gap) =>
  !(a[0] > b[2] + gap || a[2] < b[0] - gap || a[1] > b[3] + gap || a[3] < b[1] - gap);
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

// Склейка: фигуры одного объекта в Figma идут подряд, поэтому клеим соседние по порядку с близкими рамками.
// Рамки разных объектов в L могут пересекаться, так что общее слияние по пересечению не подходит.
function cluster(elements, gap = 40) {
  const groups = [];
  for (const el of elements) {
    const last = groups[groups.length - 1];
    if (last && overlaps(last.bbox, el.bbox, gap)) {
      last.items.push(el);
      last.bbox = union(last.bbox, el.bbox);
    } else groups.push({ items: [el], bbox: [...el.bbox] });
  }
  return groups;
}

function toRoles(raw, where) {
  const roles = new Set();
  const out = raw.replace(/\s(fill|stroke)="([^"]*)"/g, (all, prop, value) => {
    if (value === 'none') return all;
    const role = SOURCE_ROLES[value.toUpperCase()];
    if (!role) throw new Error(`${where}: цвет ${value} не входит в схему`);
    roles.add(role);
    return ` ${prop}="{${role}}"`;
  });
  return { markup: out, roles };
}

function buildSize(sizeKey) {
  const file = path.join(root, 'figma-svg', `size-${sizeKey}.svg`);
  // Первые две фигуры — белая подложка и рамка самого фрейма.
  const elements = readElements(file).slice(2).filter(e => e.bbox[2] - e.bbox[0] > 0 || e.bbox[3] - e.bbox[1] > 0);
  // Заголовки «Главные объекты» / «Фоновые объекты» — одиночные чёрные фигуры шире 700 px.
  const headers = elements
    .filter(e => attr(e.attrs, 'fill') === 'black' && e.bbox[2] - e.bbox[0] > 700 && e.bbox[3] - e.bbox[1] < 200)
    .sort((a, b) => a.bbox[1] - b.bbox[1]);
  if (headers.length !== 2) throw new Error(`${sizeKey}: ожидалось 2 заголовка, найдено ${headers.length}`);
  const [mainTop, bgTop] = headers.map(h => h.bbox[3]);
  const inMain = e => e.bbox[1] > mainTop && e.bbox[3] < bgTop;
  const inBg = e => e.bbox[1] > bgTop;
  const content = elements.filter(e => !headers.includes(e));
  // У фигур объектов не должно быть своих transform и прозрачности: их геометрия копируется как есть.
  for (const e of content.filter(e => inMain(e) || inBg(e))) {
    if (/\s(transform|opacity|fill-opacity|clip-path|mask)=/.test(e.attrs))
      throw new Error(`${sizeKey}: у фигуры №${e.index} есть transform/прозрачность — такую выгрузку скрипт не переносит без искажений`);
  }
  const gap = sizeKey === 'L' ? 80 : 40; // L нарисован в 2 раза крупнее
  const main = cluster(content.filter(inMain), gap);
  const bg = cluster(content.filter(inBg), gap);
  if (process.env.DEBUG) for (const g of [...main, ...bg]) console.log(g.items.length, g.bbox.map(Math.round).join(","));
  if (main.length !== config.objects.length || bg.length !== config.objects.length)
    throw new Error(`${sizeKey}: найдено ${main.length} главных и ${bg.length} фоновых, ожидалось ${config.objects.length}`);
  return { main, bg, mainTop, bgTop };
}

const center = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pack(group, where) {
  const [x0, y0, x1, y1] = group.bbox;
  const parts = group.items.map(el => toRoles(el.raw, where));
  const roles = new Set(parts.flatMap(p => [...p.roles]));
  return {
    w: +(x1 - x0).toFixed(2),
    h: +(y1 - y0).toFixed(2),
    // Сдвиг в ноль делаем обёрткой transform: координаты фигур не трогаем.
    markup: `<g transform="translate(${(-x0).toFixed(2)} ${(-y0).toFixed(2)})">${parts.map(p => p.markup).join('')}</g>`,
    roles: [...roles].sort(),
    shapes: group.items.length,
  };
}

const sizes = { S: buildSize('S'), L: buildSize('L') };
const objects = config.objects.map(o => ({ id: o.id, name: o.name, tags: o.tags, description: o.description, sizes: {} }));

// Имена: в S — по ближайшему центру из конфига; в L — тот же объект ровно в 2 раза крупнее.
const sMain = [...sizes.S.main];
for (const o of objects) {
  const want = config.objects.find(c => c.id === o.id).centerS;
  sMain.sort((a, b) => dist(center(a.bbox), want) - dist(center(b.bbox), want));
  o._s = sMain.shift();
}
const lMain = [...sizes.L.main];
for (const o of objects) {
  const w = (o._s.bbox[2] - o._s.bbox[0]) * 2, h = (o._s.bbox[3] - o._s.bbox[1]) * 2;
  lMain.sort((a, b) => Math.abs(a.bbox[2] - a.bbox[0] - w) + Math.abs(a.bbox[3] - a.bbox[1] - h)
    - (Math.abs(b.bbox[2] - b.bbox[0] - w) + Math.abs(b.bbox[3] - b.bbox[1] - h)));
  o._l = lMain.shift();
}

// Фоновый вариант — тот же рисунок под заголовком «Фоновые объекты», ищем по размеру и X.
function bgPair(sizeKey, mainGroup) {
  const [w, h] = [mainGroup.bbox[2] - mainGroup.bbox[0], mainGroup.bbox[3] - mainGroup.bbox[1]];
  const found = sizes[sizeKey].bg
    .map(g => ({ g, d: Math.abs(g.bbox[2] - g.bbox[0] - w) + Math.abs(g.bbox[3] - g.bbox[1] - h) + Math.abs(g.bbox[0] - mainGroup.bbox[0]) }))
    .sort((a, b) => a.d - b.d)[0];
  if (found.d > 60) throw new Error(`${sizeKey}: не нашёл фоновый вариант для объекта у x=${mainGroup.bbox[0]}`);
  return found.g;
}

for (const o of objects) {
  for (const [key, group] of [['S', o._s], ['L', o._l]]) {
    o.sizes[key] = {
      main: pack(group, `${o.id}/${key}/main`),
      bg: pack(bgPair(key, group), `${o.id}/${key}/bg`),
    };
  }
  delete o._s; delete o._l;
  for (const key of ['S', 'L']) {
    const bgRoles = o.sizes[key].bg.roles.filter(r => r.startsWith('obj') || r === 'white');
    if (bgRoles.length) throw new Error(`${o.id}/${key}: фоновый вариант содержит цвета объектов (${bgRoles})`);
  }
}

// Декор фона: овал-облачко и тонкие линии из фрейма «Фон» исходной (фиолетовой) схемы.
// Берём фигуры, которые идут сразу за квадратной подложкой цвета bg1, до следующей подложки.
function buildDecor(sizeKey) {
  const all = readElements(path.join(root, 'figma-svg', `size-${sizeKey}.svg`));
  const isFrame = e => e.tag === 'rect' && /translate/.test(attr(e.attrs, 'transform') || '')
    && attr(e.attrs, 'width') === attr(e.attrs, 'height');
  const start = all.findIndex(e => isFrame(e) && attr(e.attrs, 'fill')?.toUpperCase() === '#D7CDF5');
  if (start < 0) throw new Error(`${sizeKey}: не найден фрейм «Фон»`);
  const frame = all[start];
  const size = frame.bbox[2] - frame.bbox[0];
  const inside = [];
  for (const e of all.slice(start + 1)) {
    if (isFrame(e)) break;
    if (e.bbox[0] >= frame.bbox[0] - 1 && e.bbox[2] <= frame.bbox[2] + 1 && e.bbox[1] >= frame.bbox[1] - 1 && e.bbox[3] <= frame.bbox[3] + 1) inside.push(e);
  }
  const items = cluster(inside, size * 0.02).map(g => {
    const p = pack(g, `decor/${sizeKey}`);
    return { x: +((g.bbox[0] - frame.bbox[0]) / size).toFixed(4), y: +((g.bbox[1] - frame.bbox[1]) / size).toFixed(4), w: p.w, h: p.h, markup: p.markup, roles: p.roles };
  });
  if (!items.length) throw new Error(`${sizeKey}: во фрейме «Фон» нет декора`);
  return { frame: size, items };
}

const library = {
  source: 'Figma: «Тестовое | иллюстрации», фреймы «Размер L» и «Размер S»',
  // S нарисован ровно в 2 раза мельче L. Приводим к единицам L, чтобы смена L/S не меняла размеры.
  unitScale: { L: 1, S: 2 },
  schemes: config.schemes,
  objects,
  decor: { L: buildDecor('L'), S: buildDecor('S') },
};
const out = path.join(root, 'src/library.generated.json');
fs.writeFileSync(out, JSON.stringify(library));
const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`library: ${objects.length} объектов × 2 размера × 2 вида, ${kb} КБ`);
for (const o of objects)
  console.log(`  ${o.id.padEnd(11)} L ${o.sizes.L.main.w}×${o.sizes.L.main.h} (${o.sizes.L.main.shapes} фигур)  S ${o.sizes.S.main.w}×${o.sizes.S.main.h} (${o.sizes.S.main.shapes})`);
