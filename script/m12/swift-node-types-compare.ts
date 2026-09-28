// M12.21 Swift: verify every node type referenced by the analyzer against the
// pinned grammar's ACTUAL emitted types (extracted from swift-nio files).
// Classifies each ref as present, or a dead defensive alternative that the
// pinned grammar never emits (never fires — same category as C/C++/Rust/ObjC
// pre-existing dead refs).
import { readFileSync, statSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { ASTEngine } from "../../src/ast/engine"

const ANALYZER = "src/ast/real-swift-analyzer.ts"
const REPO = "$HOME/fixtures/repositories/swift-nio"
const TYPES_CACHE = "/tmp/tree-sitter-swift-emitted-types.json"

function collectRefs(src: string): Set<string> {
  const refs = new Set<string>()
  const re = /(?:===|!==)\s*"([a-z_]+)"|findChildByType\([^,]+,\s*"([a-z_]+)"\)|hasChildType\([^,]+,\s*"([a-z_]+)"\)|hasAnonToken\([^,]+,\s*"([a-z_]+)"\)|hasDescendantAnonToken\([^,]+,\s*"([a-z_]+)"\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    for (let i = 1; i <= 5; i++) {
      if (m[i]) refs.add(m[i])
    }
  }
  return refs
}

async function main() {
  const src = readFileSync(ANALYZER, "utf8")
  const refs = collectRefs(src)

  let emitted: { named: Set<string>; anon: Set<string> } | null = null
  if (existsSync(TYPES_CACHE)) {
    const cached = JSON.parse(readFileSync(TYPES_CACHE, "utf8"))
    emitted = { named: new Set(cached.named), anon: new Set(cached.anon) }
  } else {
    emitted = await extractEmittedTypes()
    writeFileSync(TYPES_CACHE, JSON.stringify({ named: [...emitted.named], anon: [...emitted.anon] }))
  }

  const all = new Set([...emitted.named, ...emitted.anon])
  const missing: string[] = []
  for (const r of refs) {
    if (!all.has(r)) missing.push(r)
  }

  const dead = missing.filter((r) => !emitted!.named.has(r) && !emitted!.anon.has(r))

  console.log(`analyzer refs: ${refs.size}`)
  console.log(`pinned grammar emitted: ${emitted.named.size} named + ${emitted.anon.size} anon tokens`)
  console.log(`refs present: ${refs.size - missing.length}`)
  console.log(`truly absent (dead defensive alternatives, never emitted): ${dead.length}`)
  for (const f of dead) console.log(`  DEAD ${f}`)
}

async function extractEmittedTypes(): Promise<{ named: Set<string>; anon: Set<string> }> {
  const tracked: string[] = execSync(`cd ${REPO} && git ls-files '*.swift'`, { encoding: "utf8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
  const parser = await ASTEngine.getParser("swift")
  const named = new Set<string>()
  const anon = new Set<string>()
  let files = 0
  for (const f of tracked) {
    try {
      if (statSync(join(REPO, f)).size < 1024) continue
      const tree = parser.parse(readFileSync(join(REPO, f), "utf8"))
      const stack: any[] = [tree.rootNode]
      while (stack.length) {
        const n = stack.pop()!
        if (n.isNamed) named.add(n.type)
        else anon.add(n.type)
        for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
      }
      files++
      if (files >= 401) break
    } catch {
      /* skip unreadable */
    }
  }
  console.log(`(extracted from ${files} files)`)
  return { named, anon }
}

main().catch((e) => { console.error(e); process.exit(1) })
