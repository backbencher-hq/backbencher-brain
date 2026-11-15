import type { ReactNode } from "react"

// Rich — the one place backtick spans in authored copy become code.
//
// The depth records are written by hand, and their most useful half is the
// limitations list, where a bare identifier needs to read as an identifier:
// "calling `eval` or a subshell reads as unreferenced". Rendered as plain text
// the backticks leak into the page and the sentence loses its meaning; the
// alternative — stripping them at author time — would throw away the author's
// own emphasis and make the data files harder to read as prose.
//
// On the Evidence Atlas surface the token is the reading column's own `<code>`
// (globals.css), so the span inherits the same ink chip a registry id gets. It is
// deliberately not a Markdown parser: only backticks are honoured, so no
// authored string can introduce markup.
export function Rich({ text }: { text: string }): ReactNode {
  const parts = text.split("`")
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) => {
        if (part === "") return null
        // Odd indices sat between a pair of backticks. An unpaired trailing
        // backtick lands on an odd index too, so a stray one degrades to plain
        // text instead of swallowing the rest of the sentence into a code span.
        return i % 2 === 1 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>
      })}
    </>
  )
}
