// ide/vscode/src/webview-dom.ts — the ONE escaping DOM port + serializer.
//
// Extracted from graph-panel.ts (M55.V1). It was already declared "no vscode
// import" there — but it lived in a file that imports vscode, so any module
// that wanted the port inherited the editor dependency and could not be run by
// a headless gate. The status surface hit exactly that wall: a pure renderer
// that silently pulls in vscode is not pure, and a rule that cannot run in a
// gate cannot be verified (the same reason graph-panel re-exports
// applyResolutionTitle from ./identity-label).
//
// This file has no imports at all, on purpose. graph-panel.ts re-exports these
// names so the hub / impact / graph panels keep their single import site; the
// pure surfaces import them from HERE.

/** Escaping DOM port over strings (browser Element API, no vscode import). */
export class StringElement {
  tagName: string
  className = ""
  attrs: Record<string, string> = {}
  textContent = ""
  children: StringElement[] = []
  constructor(tag: string) {
    this.tagName = tag
  }
  addClass(c: string): void {
    this.className = this.className ? `${this.className} ${c}` : c
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v
  }
  appendChild(child: StringElement): StringElement {
    this.children.push(child)
    return child
  }
}

export function escapeHtmlValue(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function serialize(el: StringElement): string {
  const attrs = Object.entries(el.attrs)
    .map(([k, v]) => ` ${k}="${escapeHtmlValue(v)}"`)
    .join("")
  const cls = el.className ? ` class="${escapeHtmlValue(el.className)}"` : ""
  const open = `<${el.tagName}${cls}${attrs}`
  if (el.children.length === 0) return `${open}>${escapeHtmlValue(el.textContent)}</${el.tagName}>`
  return `${open}>${el.children.map(serialize).join("")}</${el.tagName}>`
}
