import { normTarget } from "../differential"
const cases = ["<=", "<", "<:<", "<<", "<<=", "<-", "<%", "List[Int]", "Map[String, Int]", "foo", "a.b", "scala.collection.List"]
console.log("| target | normTarget |")
console.log("|---|---|")
for (const c of cases) console.log(`| ${JSON.stringify(c)} | ${JSON.stringify(normTarget(c))} |`)
// how many DISTINCT targets collapse onto the same normalised value?
const groups = new Map<string, string[]>()
for (const c of cases) {
  const n = normTarget(c)
  if (!groups.has(n)) groups.set(n, [])
  groups.get(n)!.push(c)
}
console.log("\ncollisions:")
for (const [n, v] of groups) if (v.length > 1) console.log(`  normTarget -> ${JSON.stringify(n)}  from ${v.length}: ${v.map((x) => JSON.stringify(x)).join(", ")}`)
