// Verify the registry is intact after the repair: every lane present exactly once, and the
// 6 recovered lanes are actually in LANGS (not merely parseable).
const { LANGS } = await import(process.cwd() + "/script/m14/differential.ts")
const keys = Object.keys(LANGS)
console.log(`LANGS entries: ${keys.length}`)
const recovered = ["hcl", "nim", "perl", "sql", "vb", "xml"]
const missing = recovered.filter((k) => !(k in LANGS))
console.log(`recovered lanes present: ${missing.length === 0 ? "all 6" : "MISSING " + missing.join(",")}`)
for (const k of recovered) console.log(`   ${k.padEnd(6)} ext=${LANGS[k]?.ext}  analyzer=${LANGS[k]?.analyzerFile}`)
console.log(`make registered: ${"make" in LANGS ? "yes" : "no (left for its owner — its entry body was lost in the merge)"}`)
console.log(`csharp ext=${LANGS["csharp"]?.ext}`)
const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
console.log(`duplicate keys: ${dupes.length === 0 ? "none" : dupes.join(",")}`)
