/**
 * probe-c-blanked-define-population — HOW MANY FILES CARRY A `#define` WHOSE VALUE IS AN ATTRIBUTE?
 *
 * Author: Muhammad Ishaq Khan. Probe, not production code. READ-ONLY.
 *
 * THE QUESTION. `engine.ts`'s `parseRaw` blanks `__attribute__((...))` and `__declspec(...)` before
 * the tree is parsed, and MEASURED (`probe-c-marker-verdict.ts`) a `#define` whose WHOLE value is an
 * attribute then has its `preproc_arg` token swallow the NEXT LINE — so the declaration after it is
 * no longer a declaration, on the production path, for every C and C++ file.
 *
 * This probe prices that defect class by TEXT (no parse — the point is the shape of the source):
 * for every `.c` and `.h` file in the corpus, how many `#define` lines have a value that is an
 * ATTRIBUTE (the shape that blanks to whitespace and so lets the token run on)?
 *
 * SCOPE, stated: the corpus's tracked `.c` and `.h` files under the campaign's farm
 * (`BB_CORPUS_ROOT=$PWD/.corpus`). **This is NOT the gate's admitted population** — the gate's
 * admission is by extension plus the router's attribution, and this walk is by extension only — so
 * the number is an UPPER BOUND on the admitted population's share, and it is labelled as such.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".")
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")

/** A `#define NAME <value>` whose value is an attribute — the shape that blanks to whitespace. */
function attributeValueDefines(text: string): { wholesale: number; externPrefixed: number } {
  let wholesale = 0
  let externPrefixed = 0
  const lines = text.split("\n")
  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith("#")) continue
    const m = t.match(/^#\s*define\s+[A-Za-z_][A-Za-z0-9_]*\s+(\S.*)$/)
    if (!m) continue
    const value = m[1]
    // TWO SHAPES, AND THEY ARE NOT THE SAME DEFECT:
    //   WHOLESALE — the value IS the attribute, so the blanking leaves a value that is pure
    //               whitespace, and tree-sitter-c's `preproc_arg` token (which can match a
    //               newline) then swallows the NEXT LINE into the macro's own argument. THIS is
    //               the shape that destroys the declaration after it (measured by
    //               probe-c-marker-verdict.ts).
    //   EXTERN-PREFIXED — the value opens with `extern` and then carries the attribute, so after
    //               the blanking the value still starts with a word, and MEASURED the next line
    //               survives (the CFX_WIN_EXPORT case).
    if (/^__attribute__\s*\(\(/.test(value)) wholesale++
    else if (/^__declspec\s*\(/.test(value)) wholesale++
    else if (/^extern\s+__attribute__\s*\(\(/.test(value)) externPrefixed++
    else if (/^extern\s+__declspec\s*\(/.test(value)) externPrefixed++
  }
  return { wholesale, externPrefixed }
}

function* walk(dir: string): Generator<string> {
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules") continue
    const p = path.join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walk(p)
    else yield p
  }
}

function main(): void {
  const byExt: Record<string, { files: number; filesWithAttrDefine: number; defines: number }> = {}
  let repos = 0
  let files = 0
  let filesWith = 0
  let defines = 0
  let filesWholesale = 0
  let wholesale = 0
  let externPrefixed = 0
  for (const repo of readdirSync(CORPUS)) {
    const rp = path.join(CORPUS, repo)
    let st
    try {
      st = statSync(rp)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    repos++
    for (const f of walk(rp)) {
      const ext = path.extname(f).toLowerCase()
      if (ext !== ".c" && ext !== ".h") continue
      files++
      let text: string
      try {
        text = readFileSync(f, "utf8")
      } catch {
        continue
      }
      const n = attributeValueDefines(text)
      const rec = (byExt[ext] ??= { files: 0, filesWithAttrDefine: 0, defines: 0 })
      rec.files++
      if (n.wholesale + n.externPrefixed > 0) {
        rec.filesWithAttrDefine++
        rec.defines += n.wholesale + n.externPrefixed
        filesWith++
        defines += n.wholesale + n.externPrefixed
      }
      if (n.wholesale > 0) {
        filesWholesale++
        wholesale += n.wholesale
      }
      externPrefixed += n.externPrefixed
    }
  }
  console.log("probe-c-blanked-define-population")
  console.log(`  corpus root        : ${CORPUS}`)
  console.log(`  repos walked       : ${repos}`)
  console.log(`  .c/.h files walked : ${files}`)
  console.log(`  files with >=1 attribute-valued #define : ${filesWith} (${((filesWith / Math.max(files,1)) * 100).toFixed(2)} %)`)
  console.log(`  attribute-valued #define lines in total : ${defines}`)
  console.log("")
  console.log("  THE TWO SHAPES — only the WHOLESALE one swallows the next line:")
  console.log(`    WHOLESALE (the value IS the attribute)  : ${wholesale} defines in ${filesWholesale} files`)
  console.log(`    EXTERN-PREFIXED (extern + attribute)   : ${externPrefixed} defines`)
  for (const [ext, r] of Object.entries(byExt)) {
    console.log(`  ${ext}: files ${r.files} · with an attribute-valued define ${r.filesWithAttrDefine} · defines ${r.defines}`)
  }
  console.log("")
  console.log("  SCOPE LIMIT: this is the corpus's tracked .c/.h files by EXTENSION, not the gate's")
  console.log("  admitted population — an UPPER BOUND on the admitted population's share, labelled as such.")
}

main()
