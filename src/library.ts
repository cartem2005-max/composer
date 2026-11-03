import data from './library.generated.json';
import type { CanvasRole, Library, LibraryObject, ObjectId, Role, Scheme, ShapeSet, SizeKey, Variant } from './types';

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

export function resolveRole(role: Role, variant: Variant, tone: number, canvas: CanvasRole = 'bg1'): Role {
  if (variant === 'bg') return bgRole(role, tone, canvas);
  return MAIN_TONES[tone % MAIN_TONES.length][role] ?? role;
}

/**
 * Фоновые объекты нарисованы заливкой bg1 и линиями bg3 — под кадр цвета bg1, как в макете.
 * На другом цвете кадра линии сливаются с фоном, поэтому фоновый объект подстраивается:
 * заливка — в цвет кадра (тон 2 — соседний оттенок), линии — bg3, а на кадре bg3 — светлые bg1.
 * Цвета берутся только из оттенков фона схемы.
 */
function bgRole(role: Role, tone: number, canvas: CanvasRole): Role {
  if (role === 'bg1') return tone % BG_TONES.length ? (canvas === 'bg2' ? 'bg1' : 'bg2') : canvas;
  if (role === 'bg3') return canvas === 'bg3' ? 'bg1' : 'bg3';
  return role;
}

/** Декор фона (линии bg3, овал bg2): элемент цвета кадра заменяется светлым bg1, чтобы не пропадал. */
export function decorRole(role: Role, canvas: CanvasRole): Role {
  return role === canvas ? 'bg1' : role;
}

/** Подставляет реальные HEX выбранной схемы вместо ролей. Геометрия не меняется. */
export function paint(markup: string, scheme: Scheme, variant: Variant, tone: number, canvas: CanvasRole = 'bg1'): string {
  return markup.replace(/\{(\w+)\}/g, (_, role: Role) => scheme[resolveRole(role, variant, tone, canvas)]);
}

export function paintDecor(markup: string, scheme: Scheme, canvas: CanvasRole): string {
  return markup.replace(/\{(\w+)\}/g, (_, role: Role) => scheme[decorRole(role, canvas)]);
}
