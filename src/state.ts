import type { Composition, Instance } from './types';

/** Хранилище композиции с отменой. Каждое изменение — новый снимок, старый уходит в историю. */
export class Store {
  private past: Composition[] = [];
  private future: Composition[] = [];
  private listeners: (() => void)[] = [];
  private nextUid = 1;
  selected: number | null = null;

  constructor(public state: Composition) {
    this.nextUid = Math.max(0, ...state.items.map(i => i.uid)) + 1;
  }

  subscribe(fn: () => void) { this.listeners.push(fn); }
  private emit() { for (const fn of this.listeners) fn(); }

  /** recordHistory = false — для промежуточных шагов перетаскивания. */
  update(fn: (draft: Composition) => void, recordHistory = true) {
    const next = structuredClone(this.state);
    fn(next);
    if (recordHistory) {
      this.past.push(this.state);
      if (this.past.length > 100) this.past.shift();
      this.future = [];
    }
    this.state = next;
    this.syncUid();
    if (this.selected !== null && !next.items.some(i => i.uid === this.selected)) this.selected = null;
    this.emit();
  }

  /** Новая композиция (подбор, пересборка) нумерует объекты заново — счётчик не должен выдать уже занятый номер. */
  private syncUid() {
    this.nextUid = Math.max(this.nextUid, ...this.state.items.map(i => i.uid + 1));
  }

  /** Начало жеста (перетаскивание, поворот): один снимок в историю на весь жест. */
  checkpoint() {
    this.past.push(structuredClone(this.state));
    this.future = [];
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.state);
    this.state = prev;
    this.syncUid();
    this.emit();
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.state);
    this.state = next;
    this.syncUid();
    this.emit();
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  select(uid: number | null) { this.selected = uid; this.emit(); }
  newUid() { return this.nextUid++; }

  withUid(item: Omit<Instance, 'uid'>): Instance { return { ...item, uid: this.newUid() }; }

  get selectedItem(): Instance | undefined {
    return this.state.items.find(i => i.uid === this.selected);
  }
}
