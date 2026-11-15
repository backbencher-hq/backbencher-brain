/** R4 — WOULD FILE-PATH-QUALIFIED NAMES DECIDE LOCALITY EXACTLY? The builder knows each file's path
 *  (it is the `fileName` the scss spec already uses), and a java package IS its directory, so the
 *  qualified name is derivable without a grammar change. Scored against the same path truth. */
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../src/ast/pool-worker"
const CR = "/home/ishaq2321/bb_tests/repositories"
const dir = path.join(CR, "grails-core")
const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
const javaFiles = tracked.filter((f) => f.endsWith(".java") && (() => { try { return statSync(path.join(dir, f)).size <= 1024 * 1024 } catch { return false } })())
// the qualified-name set a file-path-aware builder would produce
const qualified = new Set<string>()
const TYPE_KINDS = new Set(["class", "interface", "enum", "struct", "annotation"])
const parsedFiles: { rel: string; r: any }[] = []
for (const rel of javaFiles) {
  const r: any = await parseFile(path.join(dir, rel), dir, { projectRoot: dir } as any)
  parsedFiles.push({ rel, r })
  const pkg = rel.split("/").slice(0, -1).join(".")
  for (const s of (r?.symbols ?? [])) {
    const kind = String(s?.kind ?? "")
    const name = String(s?.name ?? "")
    if (!name || !TYPE_KINDS.has(kind)) continue
    for (let i = pkg.split(".").length; i > 1; i--) qualified.add(pkg.split(".").slice(-i).join(".") + "." + name)
  }
}
const truth = (fqn: string): boolean => {
  const parts = fqn.split("."); const leaf = parts.pop() ?? ""; const d = parts.join("/")
  if (!leaf) return false
  return tracked.some((p) => (p.endsWith(`/${leaf}.java`) || p.endsWith(`/${leaf}.groovy`)) && (d === "" || p.slice(0, p.lastIndexOf("/")).endsWith("/" + d) || p.slice(0, p.lastIndexOf("/")) === d))
}
let tp = 0, fp = 0, fn = 0
let total = 0
for (const { r } of parsedFiles) {
  for (const e of (r?.relationships ?? [])) {
    if (String(e.type) !== "imports") continue
    const fqn = String(e.target ?? ""); if (!fqn.includes(".")) continue
    total++
    const pred = qualified.has(fqn); const t = truth(fqn)
    if (pred && t) tp++; else if (pred && !t) fp++; else if (!pred && t) fn++
  }
}
console.log(`imports scored: ${total} | qualified names available: ${qualified.size}`)
console.log("R4 FQN-in-qualified-index :", JSON.stringify({ precision: +(tp / Math.max(1, tp + fp)).toFixed(4), recall: +(tp / Math.max(1, tp + fn)).toFixed(4), trueLocal: tp, falseBindings: fp, missed: fn }))
