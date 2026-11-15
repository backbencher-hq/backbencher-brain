// src/lsp/doc_comment.ts — the ONE owner of "what documentation belongs to this
// symbol".
//
// WHY THIS IS NOT A STORAGE CHANGE (measured 2026-10-07). `brain_symbol
// .docstring` EXISTS and is empty: 0 of 10,263 symbols in the owner's real
// 201-file index carry one. So the obvious route — teach 48 analyzers to extract
// and store docstrings — is a large change across every language, and it would
// still read the comment out of a file on disk rather than the one on screen.
//
// The documentation was in hand the whole time. Hover already parses the file,
// so the tree already carries the comment nodes; measured on `line-address.ts`,
// 70 of them, and the one immediately above `formatAddress` is exactly its
// docstring. `parseForSafety` now reads them out while the tree is alive (it
// frees the tree in a `finally`, so returning the tree would hand out a released
// WASM handle, and re-parsing would double the cost of every hover) and passes
// the small answer here.
//
// THE ATTACHMENT RULE, and why it is not "the nearest comment".
//
// The naive rule — walk up, take the first comment — passes the happy path and
// is wrong everywhere else. A file that documents A, then has thirty lines of
// unrelated code, then declares B: B would be given A's comment. That is worse
// than showing nothing, because it is confidently wrong, and a reader has no way
// to tell a borrowed comment from an owned one.
//
// So a comment belongs to a declaration only when it is ADJACENT to it: the
// comment's last line is the line immediately above the declaration's first line.
// That is the convention every language's doc tooling uses, it is decidable, and
// it is what makes "no documentation" an honest absence rather than a guess.
//
// WHAT IT DOES NOT DO. It does not invent a doc, does not fall back to a
// trailing comment or a section banner, and does not search past a blank line.
// When there is no adjacent comment the answer is "" and the caller renders
// nothing — §14 Truth Rule 1, the same rule the usage count follows.

import type { CommentSite } from "../ast/safety-primitives"

/**
 * Strip comment syntax to the prose a human wrote.
 *
 * Deliberately conservative: it removes the delimiters and the leading
 * continuation marks, and it keeps the text otherwise. It does NOT reflow, wrap,
 * capitalise or reorder — a doc comment is the author's words, and rewriting them
 * would make the hover a paraphrase of the source rather than a view of it.
 */
export function stripCommentMarkup(raw: string): string {
  const lines = raw.split("\n")
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    let l = lines[i]!.replace(/\r$/, "")
    if (i === 0) l = l.replace(/^\s*\/\*+\s?/, "").replace(/^\s*#+\s?/, "").replace(/^\s*--+\s?/, "")
    if (i === lines.length - 1) l = l.replace(/\s?\*+\/\s*$/, "")
    // JSDoc / rustdoc / C# continuation: strip one leading marker plus a space.
    l = l.replace(/^\s*\*\s?/, "")
    l = l.replace(/^\s*\/\/\/\s?/, "")
    l = l.replace(/^\s*#\s?/, "")
    out.push(l.replace(/\s+$/, ""))
  }
  while (out.length > 0 && out[0]!.trim() === "") out.shift()
  while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop()
  return out.join("\n").trim()
}

/**
 * The documentation attached to a declaration starting on `declarationLine`
 * (1-based), or "" when none is adjacent.
 *
 * `sites` may be null or empty — the caller may have no parse, or a language
 * whose grammar emits no comment nodes — and "" is the answer, not a search it
 * cannot honestly make.
 */
export function docCommentFor(sites: CommentSite[] | null | undefined, declarationLine: number | null | undefined): string {
  if (sites === null || sites === undefined || sites.length === 0) return ""
  if (declarationLine === null || declarationLine === undefined || declarationLine < 1) return ""
  const target = declarationLine - 1 // the line the comment must END on
  for (const site of sites) {
    if (site.endLine === target) return stripCommentMarkup(site.text)
  }
  return ""
}