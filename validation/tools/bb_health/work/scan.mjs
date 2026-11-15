// Precise-ish regex-literal + banned-comment scanner for the bb_health campaign files.
import { readFileSync } from "node:fs"
const files = process.argv.slice(2)
function regexLiterals(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++ }
      i++; continue
    }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue }
    if (c === "/") {
      const before = src.slice(Math.max(0, i - 30), i).trimEnd()
      const prev = before[before.length - 1] ?? ""
      // a regex literal can only start where an expression may start
      if (prev === "" || "=(,:[!&|?{};+-*%<>~^".includes(prev) || /(?:^|\s)(?:return|case|typeof|instanceof|in|of|delete|void|new)$/.test(before)) {
        let j = i + 1, closed = false, inClass = false
        while (j < src.length) {
          const d = src[j]
          if (d === "\\") { j += 2; continue }
          if (d === "[") inClass = true
          else if (d === "]") inClass = false
          else if (d === "/" && !inClass) { closed = true; break }
          else if (d === "\n") break
          j++
        }
        if (closed) {
          let k = j + 1
          while (k < src.length && /[a-z]/i.test(src[k])) k++
          const line = src.slice(0, i).split("\n").length
          const literal = src.slice(i, k)
          if (!/^\/\*/.test(literal)) out.push({ line, literal })
          i = k; continue
        }
      }
    }
    i++
  }
  return out
}
const BANNED = [
  ["owner-narrative", /\b(?:the )?owner (?:said|asked|decided|approved|instructed|admitted)\b|owner-approved/i],
  ["the-Lead", /\bthe Lead\b|\bthe lead's\b|\bLead\b(?!-) /],
  ["lane", /\bthis lane\b|\bthe lane\b|\bladder\b/i],
  ["teammate", /\bteammates?\b/i],
  ["agent-door", /\bthe agent door\b/i],
  ["issue-number", /issue #\d+/i],
  ["task-id", /\btask-\d+\b/i],
  ["milestone", /\bM\d{1,3}(?:\.(?:[A-Z]\d+[a-z]?|\d+))*\b/],
  ["measured-date", /MEASURED\s+(?:ON\s+)?\d{4}-\d{2}-\d{2}/i],
  ["defect-fixed-date", /defect fixed \d{4}/i],
  ["shipped", /\bshipped\b/i],
  ["standing-rule", /\bstanding rule\b/i],
  ["fleet", /\bthe fleet\b/i],
  ["generated-with", /Generated with|Co-Authored-By/i],
]
let total = 0
for (const f of files) {
  let src
  try { src = readFileSync(f, "utf8") } catch { console.log(`MISSING ${f}`); continue }
  const rel = regexLiterals(src)
  const banned = []
  src.split("\n").forEach((text, idx) => {
    for (const [name, re] of BANNED) if (re.test(text)) banned.push({ line: idx + 1, name, text: text.trim().slice(0, 130) })
  })
  const regExpCtors = (src.match(/new RegExp\(/g) || []).length
  total += banned.length
  console.log(`\n=== ${f}`)
  console.log(`regex literals: ${rel.length}${rel.length ? " -> " + rel.map((r) => `${r.line}:${r.literal}`).join("  ") : ""}`)
  console.log(`new RegExp: ${regExpCtors}`)
  console.log(`banned-pattern lines: ${banned.length}`)
  for (const b of banned.slice(0, 40)) console.log(`  L${b.line} [${b.name}] ${b.text}`)
  if (banned.length > 40) console.log(`  ... ${banned.length - 40} more`)
}
console.log(`\nTOTAL banned-pattern lines: ${total}`)
