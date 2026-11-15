// One-shot repair: the dimension-8 line pins were appended to the wrong array
// (the last entry of `forbidRelationships` is also a `calls` pin, so the anchor
// matched the negative array). This moves the pins that name a line_number into
// `expectRelationships` and leaves `expectRelationshipCount` as its own member.
import { readFileSync, writeFileSync } from "node:fs"

const FILE = process.argv[2] ?? "validation/m14/fixtures/haskell/payload-and-complexity.expectation.json"
const lines = readFileSync(FILE, "utf8").split("\n")
const idx = (pred: (l: string, i: number) => boolean, from = 0) => lines.findIndex((l, i) => i >= from && pred(l, i))
const isClose = (l: string) => l.trim() === "],"

const expectStart = idx((l) => l.includes('"expectRelationships": ['))
const expectEnd = idx(isClose, expectStart)
const forbidStart = idx((l) => l.includes('"forbidRelationships": ['))
const combineIdx = idx((l) => l.includes("a definition head never calls itself"))
const forbidEnd = idx(isClose, combineIdx)
const countStart = idx((l) => l.includes('"expectRelationshipCount": ['))
const countEnd = idx(isClose, countStart)

if ([expectStart, expectEnd, forbidStart, combineIdx, forbidEnd, countStart, countEnd].some((i) => i < 0))
  throw new Error("anchor not found — refusing to guess")

const pins = lines.slice(combineIdx + 1, forbidEnd).filter((l) => l.trim().length > 0)
if (!pins.every((l) => l.includes("line_number"))) throw new Error("the extracted block is not the line pins")
const countBlock = lines.slice(countStart, countEnd + 1).filter((l) => l.trim().length > 0)

const out: string[] = [
  ...lines.slice(0, expectEnd),
  ...pins,
  lines[expectEnd],
  ...countBlock,
  ...lines.slice(expectEnd + 1, combineIdx),
  lines[combineIdx].replace(/,\s*$/, ""),
  lines[forbidEnd],
  ...lines.slice(countEnd + 1),
]
writeFileSync(FILE, out.join("\n"))
console.log(`moved ${pins.length} line pins into expectRelationships; expected open/close now at ${expectStart}, pins reinserted at ${expectEnd}`)
