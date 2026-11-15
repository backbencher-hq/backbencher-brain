// Prove the F6 comment-masker removes ONLY comment-derived literals (never a
// real comparison). If it removed a live literal the gate would go vacuous.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const MOD = await import(path.join(ROOT, "script/m14/verify-fixture-coverage.ts")).catch(() => null as any)
const maskComments: (s: string) => string = (MOD as any)?.__maskComments ?? (() => { throw new Error("masker not exported") })()
const PATS = [
  /\.[tT]ype\s*===\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /\.[tT]ype\s*!==\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /findChildByType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
  /hasChildType\([^,]+,\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
]
const langs = ["java","javascript","cpp","go","zig","php","ruby","python","swift","rust","c","kotlin","scala","dart","objc"]
for (const l of langs) {
  const p = path.join(ROOT, "src/ast/real-" + (l === "objectivec" ? "objective-c" : l) + "-analyzer.ts")
  const f = l === "c" ? path.join(ROOT, "src/ast/real-c-analyzer.ts") : p
  if (!fs.existsSync(f)) continue
  const src = fs.readFileSync(f, "utf8")
  const masked = maskComments(src)
  const set = (s: string) => { const o = new Set<string>(); for (const re of PATS) for (const m of s.matchAll(re)) o.add(m[1]); return o }
  const raw = set(src), mk = set(masked)
  const removed = [...raw].filter((x) => !mk.has(x))
  const added = [...mk].filter((x) => !raw.has(x))
  console.log(`${l.padEnd(12)} raw=${raw.size} masked=${mk.size} removed=[${removed}] added=[${added}]`)
}
