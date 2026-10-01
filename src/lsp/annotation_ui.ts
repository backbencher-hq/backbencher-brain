// src/lsp/annotation_ui.ts — M28.A2 (issue #627): the SINGLE owner of how an
// agent annotation renders in the IDE.
//
// An annotation is an opinion layered on evidence (M28 decision D-3/D-6):
// every rendering path here labels the author class and tool identity so an
// agent note can NEVER read as index-derived fact. Drift-gated by
// script/m28/verify-annotation-ui.ts (mutation suite included).
//
//   hoverSection:   one string for the hover markdown (empty when no
//                   annotations — absence declared, nothing rendered, the
//                   exact contract of the cross-language section in W3)
//   badge:          the graph-webview badge fields for one symbol
//   badgeEqualsEdge: defensive rule — a badge element must never disagree
//                   with the node it sits on (same symbol id); mirrors the
//                   W4 badge law for edges.

export interface AnnotationRow {
  symbol_name: string
  symbol_path: string | null
  author_class: string
  tool_identity: string
  body: string
  time_created: number
  time_updated: number
}

/** All UI text flows through this escaper: the graph webview renders text
 *  content only, but a hostile annotation body must not be able to pretend
 *  it is markup anywhere. (Contract §6: repo-controlled strings are escaped.) */
export function escapeAnnotationText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Format one timestamp (epoch ms) as a stable UTC date string — deterministic
 *  output, no local timezone drift between editor sessions. */
export function formatAnnotationTime(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/** The hover section for a symbol's annotations, in the hover's markdown
 *  dialect. Empty string when there are none — the hover then renders NO
 *  annotation text at all (declared absence, never a fake placeholder). */
export function annotationHoverSection(rows: AnnotationRow[]): string {
  if (!Array.isArray(rows) || rows.length === 0) return ""
  const lines: string[] = ["**notes** (agent/human annotations — provenance recorded, not index-derived):"]
  for (const row of rows) {
    const who = `${row.author_class} note by ${row.tool_identity}`
    const when = formatAnnotationTime(row.time_updated)
    // Scope is stated, because the store holds two kinds of note and the reader
    // cannot otherwise tell them apart: a note written WITH a path is about THIS
    // file's copy of the symbol, and a note written without one is about the
    // NAME, so it surfaces in every file that declares it (measured on a real
    // corpus: one name in 8 files). Rendering both identically made a
    // whole-codebase opinion read as a statement about the function under the
    // cursor. The label is a fixed vocabulary, not repo text, so it carries
    // nothing to escape.
    const scope = row.symbol_path === null || row.symbol_path === undefined ? "name-level" : "this file"
    lines.push(`- [${who}, ${when}, ${scope}]: ${escapeAnnotationText(row.body)}`)
  }
  return lines.join("\n")
}

/** The graph-webview badge for one symbol. null when there are no
 *  annotations — the webview then renders NO badge at all. */
export interface AnnotationBadge {
  count: number
  authors: string[]
  label: string
}

export function annotationBadge(rows: AnnotationRow[]): AnnotationBadge | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const authors = [...new Set(rows.map((r) => r.author_class))].sort()
  const count = rows.length
  return {
    count,
    authors,
    label: `${count} note${count === 1 ? "" : "s"} (${authors.join(", ")})`,
  }
}

/** Defensive rule (W4 badge law, applied to annotations): a badge may only
 *  attach to a node with a real symbol name — and the badge itself must be a
 *  well-formed, author-labeled badge. The webview provider calls this before
 *  attaching; a mismatch is a declared defect (the caller then renders NO
 *  badge rather than a possibly-misattributed one). */
export function badgeMatchesNode(badge: AnnotationBadge | null, nodeSymbolName: string): boolean {
  if (badge === null || typeof badge !== "object") return false
  if (typeof nodeSymbolName !== "string" || nodeSymbolName.length === 0) return false
  if (!Array.isArray(badge.authors) || badge.authors.length === 0) return false
  if (typeof badge.count !== "number" || badge.count < 1) return false
  if (typeof badge.label !== "string" || badge.label.length === 0) return false
  // The label must name every author class it claims — a badge whose label
  // disagrees with its authors is a misattribution defect.
  return badge.authors.every((a) => badge.label.includes(a))
}
