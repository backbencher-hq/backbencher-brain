import type { ReactNode } from "react"

// Generated prose (FAQ answers, tool contracts, docs summaries, editor claims)
// is written with two lightweight marks: **bold** and `code`. They are
// presentation, not content — rendering them as literal asterisks and
// backticks looks like a paste accident. This renderer turns the marks into
// type. `stripRichMarks` is the same transformation as text, for the truth
// gates: a gate may compare a claim modulo presentation, never a different
// claim.
const MARKS = /(\*\*[^*]+\*\*|`[^`]+`)/g

export function stripRichMarks(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1")
}

export function RichText({ text }: { text: string }) {
  const out: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = MARKS.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index))
    const token = match[1]!
    const inner = token.slice(token.startsWith("**") ? 2 : 1, token.startsWith("**") ? -2 : -1)
    out.push(token.startsWith("**") ? <strong key={key++}>{inner}</strong> : <code key={key++}>{inner}</code>)
    last = match.index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return <>{out}</>
}
