// F10 measurement: the defect is an object-literal KEY in a TEMPLATE expression
// reading as a member. So the detection region is the TEMPLATE BLOCK only —
// regexing the whole file also matches the script's own object literals and
// reports every member name as a key, which is how the first version of this
// probe reported 425 residual edges that were mostly its own false positives.
import * as fs from "fs"
import { vue, rels } from "./harness"

const CORPUS = "/home/ishaq2321/bb_tests/repositories"

function under(root: string, limit: number) {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist") continue
      const p = path_join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".vue")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}
function path_join(...p: string[]) { return p.join("/") }

async function main() {
  const files = [...under(`${CORPUS}/element-plus`, 2000), ...under(`${CORPUS}/vue-element-admin`, 2000), ...under(`${CORPUS}/vue-core`, 200)]
  let totalTemplateUses = 0, keyReads = 0, hitFiles = 0
  const ex: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    // the TEMPLATE region only, and only its EXPRESSION text (the raw_text /
    // attribute_value fragments), which is where collectIdentifiers ever runs.
    const tpl = /<template[^>]*>([\s\S]*?)<\/template>/.exec(src)?.[1] ?? ""
    if (!tpl) continue
    const r = await vue(src, f)
    const uses = rels(r, "uses").filter((x: any) => x.metadata?.isTemplateExpression)
    totalTemplateUses += uses.length
    let n = 0
    for (const u of uses) {
      const t = String(u.target).replace(/[$]/g, "\\$")
      // a KEY position inside the template: `{ name:` / `, name:` — and NOT a
      // quoted key, which was already correct.
      if (new RegExp(`[{,]\\s*${t}\\s*:`).test(tpl) && !new RegExp(`['"\`]${t}['"\`]\\s*:`).test(tpl)) n++
    }
    if (n) { hitFiles++; keyReads += n; if (ex.length < 6) ex.push(`${f.replace(CORPUS + "/", "")}  ${n} key-shaped target(s)`) }
  }
  console.log(`=== F10 measurement, template region only ===`)
  console.log(`  corpus files: ${files.length}`)
  console.log("  template `uses` edges emitted: ${totalTemplateUses}")
  console.log(`  files with a key-shaped template target: ${hitFiles}`)
  console.log(`  such edges: ${keyReads}`)
  for (const e of ex) console.log(`    ${e}`)
  if (!hitFiles) console.log("  (a key-shaped target is not by itself a defect: `show ? count : total` and")
  console.log("   `{{ a ? b : c }}` produce a ternary target that this shape cannot distinguish —")
  console.log("   the fix is verified by the FIXTURES, this probe is the corpus-scale floor.)")
}
main()