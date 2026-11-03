import { getObject, paint, shapeSet, library } from './library';
import { getScheme } from './schemes';
import type { Composition, FormatId, Instance } from './types';

export const FORMATS: Record<FormatId, { name: string; w: number; h: number }> = {
  og: { name: '1200 × 630', w: 1200, h: 630 },
  square: { name: 'Квадрат 1080', w: 1080, h: 1080 },
  vertical: { name: 'Вертикаль 1080 × 1920', w: 1080, h: 1920 },
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** transform объекта: центр в (x, y), поворот вокруг центра, единый масштаб композиции. */
export function instanceTransform(c: Composition, it: Instance): string {
  const { w, h } = shapeSet(it.objectId, c.size, it.variant);
  const k = c.scale * library.unitScale[c.size];
  const parts = [`translate(${r2(it.x)} ${r2(it.y)})`];
  if (it.rotation) parts.push(`rotate(${r2(it.rotation)})`);
  parts.push(`scale(${Math.round(k * 1e5) / 1e5})`, `translate(${r2(-w / 2)} ${r2(-h / 2)})`);
  return parts.join(' ');
}

export function layerId(c: Composition, it: Instance): string {
  const n = c.items.filter(o => o.objectId === it.objectId && o.uid <= it.uid).length;
  return `${it.objectId}-${it.variant}-${n}`;
}

export function instanceMarkup(c: Composition, it: Instance): string {
  const scheme = getScheme(c.schemeId);
  const set = shapeSet(it.objectId, c.size, it.variant);
  return paint(set.markup, scheme, it.variant, it.tone);
}

/**
 * Декор фона — копии элементов из фрейма «Фон» макета, в тех же долях кадра.
 * Масштаб один на все элементы и считается от короткой стороны кадра, как фрейм 1000×1000 в примерах.
 */
export function decorSvg(c: Composition): string {
  const f = FORMATS[c.format];
  const d = library.decor[c.size];
  const s = Math.round((Math.min(f.w, f.h) / d.frame) * 1e5) / 1e5;
  const scheme = getScheme(c.schemeId);
  const items = d.items.map((it, i) =>
    `<g id="decor-${i + 1}" transform="translate(${r2(it.x * f.w)} ${r2(it.y * f.h)}) scale(${s})">${paint(it.markup, scheme, 'bg', 0)}</g>`);
  return `<g id="decor">${items.join('')}</g>`;
}

/**
 * Полный SVG композиции. Один и тот же код рисует холст и файл экспорта,
 * поэтому скачанный файл совпадает с тем, что видно на экране.
 */
export function compositionSvg(c: Composition, opts: { forExport?: boolean } = {}): string {
  const f = FORMATS[c.format];
  const scheme = getScheme(c.schemeId);
  const body = c.items
    .map(it => {
      const o = getObject(it.objectId);
      const label = `${o.name}, ${it.variant === 'main' ? 'главный' : 'фоновый'}`;
      return `<g id="${layerId(c, it)}" data-uid="${it.uid}" data-name="${label}" transform="${instanceTransform(c, it)}">${instanceMarkup(c, it)}</g>`;
    })
    .join('\n');
  const head = opts.forExport
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Собрано из библиотеки «Студии Очень». Схема: ${scheme.name.replace(/[<>&\u0000-\u001f\u007f]|-{2,}/g, ' ')}. Объекты — копии исходных SVG без изменений геометрии. -->\n`
    : '';
  return `${head}<svg xmlns="http://www.w3.org/2000/svg" width="${f.w}" height="${f.h}" viewBox="0 0 ${f.w} ${f.h}" fill="none">
<defs><clipPath id="frame-${f.w}x${f.h}"><rect width="${f.w}" height="${f.h}"/></clipPath></defs>
<g id="composition" clip-path="url(#frame-${f.w}x${f.h})">
<rect id="background" width="${f.w}" height="${f.h}" fill="${scheme[c.background]}"/>
${c.decor === false ? '' : decorSvg(c)}
${body}
</g>
</svg>`;
}
