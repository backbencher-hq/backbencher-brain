// Static inventory for the bb_index lane: regex uses, banned narrative markers, doc citations.
import { readFileSync } from "node:fs"
const files = process.argv.slice(2)
const banned: Array<[string, RegExp]> = [
  ["milestone-narrative", /\bM\d{1,3}\.[A-Z0-9]{1,4}\b/],
  ["issue-number", /\bissue #\d+|\B#\d{3,}\b/g],
  ["lead-narrative", /\bthe Lead\b|\bthe lead's\b/i],
  ["lane-narrative", /\bthis lane\b|\bthe lane\b|\bteammate\b|\bthe fleet\b/i],
  ["measured-date", /MEASURED \d{4}-\d{2}-\d{2}/],
  ["process-verbs", /\bowner (said|asked|decided|approved|instructed|admitted)\b|\bowner-approved\b/i],
  ["agent-marker", /Generated with|Co-Authored-By/i],
]
const regexLit = /(?:^|[=(,:!&|?{};]\s*)(\/(?![/*])(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+\/[gimsuy]*)/g
const out: any = { files: [] }
for (const f of files) {
  let text = ""
  try { text = readFileSync(f, "utf8") } catch { out.files.push({ file: f, error: "unreadable" }); continue }
  const lines = text.split("\n")
  const regexUses: any[] = []
  const bannedHits: any[] = []
  lines.forEach((line, i) => {
    if (line.trim().startsWith("//") || line.trim().startsWith("*") || line.trim().startsWith("/*")) {
      // comments still scanned for banned narrative, not for regex literals
      for (const [kind, re] of banned) { re.lastIndex = 0; const m = line.match(re); if (m) bannedHits.push({ line: i + 1, kind, match: m[0] }) }
      return
    }
    regexLit.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regexLit.exec(line))) regexUses.push({ line: i + 1, literal: m[1] })
    if (/new RegExp\(|RegExp\(/.test(line)) regexUses.push({ line: i + 1, literal: line.trim().slice(0, 120) })
    for (const [kind, re] of banned) { re.lastIndex = 0; const b = line.match(re); if (b) bannedHits.push({ line: i + 1, kind, match: b[0] }) }
  })
  out.files.push({ file: f, lines: lines.length, regexUses, bannedHits })
}
console.log(JSON.stringify(out, null, 1))
