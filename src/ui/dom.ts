export type Child = Node | string | null | false | undefined | Child[];
export function h(tag: string, attrs: Record<string, any> = {}, ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v; else if (k === 'value') (el as any).value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c: Child) => { if (Array.isArray(c)) c.forEach(add); else if (c !== null && c !== false && c !== undefined) el.append(c); };
  kids.forEach(add); return el;
}
