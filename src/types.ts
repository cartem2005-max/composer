export type ObjectId = 'book' | 'phone' | 'puzzle' | 'coin' | 'headphones' | 'lamp' | 'tulips' | 'wallet' | 'folder' | 'pen';

/** Роли цветов. bg* и black — цвета фона, obj* и white — цвета объектов. */
export type Role = 'bg1' | 'bg2' | 'bg3' | 'black' | 'obj1' | 'obj2' | 'obj3' | 'white';
export const BG_ROLES = ['bg1', 'bg2', 'bg3', 'black'] as const;
export const OBJ_ROLES = ['obj1', 'obj2', 'obj3', 'white'] as const;
export type BgRole = (typeof BG_ROLES)[number];

export type Scheme = { id: string; name: string } & Record<Role, string>;

export type SizeKey = 'L' | 'S';
export type Variant = 'main' | 'bg';

export interface ShapeSet {
  w: number;
  h: number;
  /** Разметка SVG, где вместо цветов стоят роли: fill="{obj1}". */
  markup: string;
  roles: Role[];
  shapes: number;
}

export interface LibraryObject {
  id: ObjectId;
  name: string;
  description: string;
  tags: string[];
  sizes: Record<SizeKey, Record<Variant, ShapeSet>>;
}

export interface DecorItem { x: number; y: number; w: number; h: number; markup: string; roles: Role[] }

export interface Library {
  source: string;
  unitScale: Record<SizeKey, number>;
  schemes: Scheme[];
  objects: LibraryObject[];
  /** Декор фона из фрейма «Фон»: положение — доли стороны фрейма. */
  decor: Record<SizeKey, { frame: number; items: DecorItem[] }>;
}

/** Объект на холсте. Положение — центр объекта в пикселях холста. */
export interface Instance {
  uid: number;
  objectId: ObjectId;
  variant: Variant;
  /** Номер перестановки цветов в рамках схемы (0 — как в библиотеке). */
  tone: number;
  x: number;
  y: number;
  rotation: number;
}

export type FormatId = 'og' | 'square' | 'vertical';
export type LayoutId = 'compact' | 'offset' | 'title';

export interface Composition {
  format: FormatId;
  layout: LayoutId;
  size: SizeKey;
  schemeId: string;
  background: BgRole;
  /** Общий масштаб всех объектов. Он один на композицию, поэтому пропорции между объектами не меняются. */
  scale: number;
  /** Порядок в массиве = порядок слоёв (последний сверху). */
  items: Instance[];
  /** Декор фона из макета (овал и линии). По умолчанию включён. */
  decor?: boolean;
  /** Номер варианта автораскладки: «Другой вариант» перебирает их. */
  seed?: number;
}

export interface Pick {
  id: ObjectId;
  variant: Variant;
}

export interface PickResult {
  picks: Pick[];
  source: 'ai' | 'dictionary';
  reason: string;
}
