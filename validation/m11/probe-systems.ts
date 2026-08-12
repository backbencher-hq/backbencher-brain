import { readFileSync } from "node:fs"

type Truth = { name: string; kind: string; line: number }
type Observed = { file: string; name: string; kind: string; start_line: number }

const truthDocument = JSON.parse(readFileSync("validation/m11/ground-truth/systems-symbols.json", "utf8")) as {
  files: Record<string, Truth[]>
}
const observedDocument = JSON.parse(readFileSync("validation/m11/results/systems-observed.json", "utf8")) as {
  symbols: Observed[]
}
const key = (file: string, line: number, kind: string, name: string) => `${file}:${line}:${kind}:${name}`
const truth = new Set<string>()
const observed = new Set<string>()

for (const [file, symbols] of Object.entries(truthDocument.files)) {
  for (const symbol of symbols) truth.add(key(file, symbol.line, symbol.kind, symbol.name))
}
for (const symbol of observedDocument.symbols) {
  const file = symbol.file.split("/").pop() || symbol.file
  observed.add(key(file, symbol.start_line, symbol.kind, symbol.name))
}

const missing = [...truth].filter(symbol => !observed.has(symbol))
const extras = [...observed].filter(symbol => !truth.has(symbol))
const truePositives = truth.size - missing.length
const precision = truePositives / (truePositives + extras.length)
const recall = truePositives / truth.size

console.log(`TRUTH=${truth.size} OBSERVED=${observed.size} TP=${truePositives} FN=${missing.length} FP=${extras.length}`)
for (const symbol of missing) console.log(`MISSING ${symbol}`)
for (const symbol of extras) console.log(`EXTRA ${symbol}`)
console.log(`precision=${precision.toFixed(3)} recall=${recall.toFixed(3)}`)

if (missing.length > 0 || extras.length > 0) process.exitCode = 1
