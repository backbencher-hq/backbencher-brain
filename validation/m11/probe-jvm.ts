import { readFileSync } from "fs"

type Truth = { name: string; kind: string; line: number }
type Observed = { file: string; name: string; kind: string; start_line: number }

const truth = JSON.parse(readFileSync("validation/m11/ground-truth/jvm-symbols.json", "utf8")) as Record<string, Truth[]>
const obs = JSON.parse(readFileSync("validation/m11/results/jvm-observed.json", "utf8")) as { symbols: Observed[] }
const key = (file: string, line: number, kind: string, name: string) => `${file}:${line}:${kind}:${name}`
const truthKeys = new Set<string>()
const observedKeys = new Set<string>()

for (const [file, items] of Object.entries(truth)) {
  for (const item of items) truthKeys.add(key(file, item.line, item.kind, item.name))
}
for (const item of obs.symbols) {
  const file = item.file.split("/").pop() || item.file
  observedKeys.add(key(file, item.start_line, item.kind, item.name))
}

const missing = [...truthKeys].filter(item => !observedKeys.has(item))
const extras = [...observedKeys].filter(item => !truthKeys.has(item))
const truePositives = truthKeys.size - missing.length
const precision = truePositives / (truePositives + extras.length)
const recall = truePositives / truthKeys.size

console.log(`TRUTH=${truthKeys.size} OBSERVED=${observedKeys.size} TP=${truePositives} FN=${missing.length} FP=${extras.length}`)
for (const item of missing) console.log(`MISSING ${item}`)
for (const item of extras) console.log(`EXTRA ${item}`)
console.log(`precision=${precision.toFixed(3)} recall=${recall.toFixed(3)}`)

if (missing.length > 0 || extras.length > 0) process.exitCode = 1
