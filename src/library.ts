import data from './library.generated.json';
import type { Library, LibraryObject, ObjectId, Role, Scheme, ShapeSet, SizeKey, Variant } from './types';

export const library = data as unknown as Library;

const byId = new Map(library.objects.map(o => [o.id, o]));

export function getObject(id: ObjectId): LibraryObject {
  const o = byId.get(id);
  if (!o) throw new Error(`Нет объекта ${id}`);
  return o;
}

export const OBJECT_IDS = library.objects.map(o => o.id);
export const isObjectId = (v: unknown): v is ObjectId => typeof v === 'string' && byId.has(v as ObjectId);

export function shapeSet(id: ObjectId, size: SizeKey, variant: Variant): ShapeSet {
  return getObject(id).sizes[size][variant];
}

/** Размер объекта в единицах холста при масштабе 1 (S приведён к единицам L). */
export function baseSize(id: ObjectId, size: SizeKey, variant: Variant) {
  const s = shapeSet(id, size, variant);
  const k = library.unitScale[size];
  return { w: s.w * k, h: s.h * k };
}

/**
 * Перестановки цветов объекта внутри схемы. Меняются местами только цвета объектов (obj1..obj3);
 * у фонового варианта можно выбрать тон заливки из цветов фона. Других цветов объект не получит.
 */
const MAIN_TONES: Partial<Record<Role, Role>>[] = [
  {},
  { obj1: 'obj2', obj2: 'obj1' },
  { obj1: 'obj3', obj3: 'obj1' },
  { obj2: 'obj3', obj3: 'obj2' },
  { obj1: 'obj2', obj2: 'obj3', obj3: 'obj1' },
  { obj1: 'obj3', obj2: 'obj1', obj3: 'obj2' },
];
const BG_TONES: Partial<Record<Role, Role>>[] = [{}, { bg1: 'bg2' }];

export const toneCount = (variant: Variant) => (variant === 'main' ? MAIN_TONES : BG_TONES).length;

/**
 * Тоны, которые у этого объекта действительно выглядят по-разному. У монеты или ручки S один цвет объекта,
 * и часть перестановок даёт ту же картинку — их пропускаем, чтобы «Другие цвета» не стояли на месте.
 */
export function distinctTones(id: ObjectId, size: SizeKey, variant: Variant): number[] {
  const roles = shapeSet(id, size, variant).roles;
  const seen = new Set<string>();
  const out: number[] = [];
  for (let t = 0; t < toneCount(variant); t++) {
    const key = roles.map(r => resolveRole(r, variant, t)).join(',');
    if (!seen.has(key)) { seen.add(key); out.push(t); }
  }
  return out;
}

export function resolveRole(role: Role, variant: Variant, tone: number): Role {
  const table = variant === 'main' ? MAIN_TONES : BG_TONES;
  return table[tone % table.length][role] ?? role;
}

/** Подставляет реальные HEX выбранной схемы вместо ролей. Геометрия не меняется. */
export function paint(markup: string, scheme: Scheme, variant: Variant, tone: number): string {
  return markup.replace(/\{(\w+)\}/g, (_, role: Role) => scheme[resolveRole(role, variant, tone)]);
}
