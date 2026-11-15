import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const { detectLanguageFromPath } = (await import(
  "../../../../src/ast/language-detection"
)) as any

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
const HERE = import.meta.dirname
await P.init({ locateFile: () => path.join(HERE, "../../../../node_modules/web-tree-sitter/tree-sitter.wasm") })

const files: string[] = []
for (const e of execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n")) {
  if (!e) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
      .split("\n")
      .filter((l) => l.length > 0)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (!st.isFile() || st.size > 512 * 1024) continue
    let text: string
    try {
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    files.push(abs)
  }
}
files.sort()
console.log(`admitted: ${files.length}`)

const lang = await L.load(readFileSync(path.join(HERE, "../../../../wasm/tree-sitter-xml.wasm")))

let reused = new P()
reused.setLanguage(lang)
let reusedFail = 0
let firstReusedFail = -1
for (let i = 0; i < files.length; i++) {
  const text = readFileSync(files[i]!, "utf8")
  try {
    const t = reused.parse(text)
    if (!t?.rootNode) throw new Error("no root")
    reusedFail++
  } catch {
    if (firstReusedFail < 0) firstReusedFail = i
    reusedFail++
  }
}
console.log(`ONE reused parser : failures=${reusedFail} of ${files.length}, firstFailureAtIndex=${firstReusedFail}`)
try {
  reused.delete()
} catch {
  /* wasm teardown */
}

let freshOk = 0
let freshFail = 0
let freshCrash = 0
let freshCrashAt = -1
for (let i = 0; i < files.length; i++) {
  const text = readFileSync(files[i]!, "utf8")
  let p: any
  try {
    p = new P()
    p.setLanguage(lang)
  } catch {
    // `new Parser()` itself throws once the wasm heap cannot grow any further. That is
    // the measurement, not a crash to swallow silently: count it and keep the index.
    freshCrash++
    if (freshCrashAt < 0) freshCrashAt = i
    continue
  }
  try {
    const t = p.parse(text)
    if (!t?.rootNode) throw new Error("no root")
    freshOk++
  } catch {
    freshFail++
  }
  p.delete()
}

console.log(`FRESH parser each  : ok=${freshOk} parseFail=${freshFail} newParserThrew=${freshCrash} firstThrowAtIndex=${freshCrashAt}`)
