// NAME-COLLISION FALSIFIER (yaml) — the falsifier the lane's biggest RULED CLASS needs.
//
// THE RULING IT TESTS. A relation-object name that is not declared in the edge's own file
// (`secretName: test`, `serviceAccountName: default`, `include_role: name=dnf`) is emitted with
// `isExternal: true`, and the arbiter's project-scope re-resolution counts declarations BY NAME —
// so a target whose spelling also appears as an ordinary mapping key elsewhere in the project is
// reported AMBIGUOUS. The lane's position is that this is the COUNT MODEL's limit and not a wrong
// edge: the referent is not a declaration of the kind the reference asks for.
//
// THE FALSIFIER, and it is the whole point of this instrument: if the project DOES declare a
// referent of the SAME KIND with that name, the ruling is WRONG for that edge and the edge must
// resolve. Kind is read off the REFERRING KEY, never off the target's spelling:
//
//   secretName / secretRef / secretKeyRef   -> Secret
//   claimName                               -> PersistentVolumeClaim
//   configMap / configMapRef / configMapKeyRef -> ConfigMap
//   serviceAccountName                      -> ServiceAccount
//   include_role / import_role              -> an ansible ROLE, i.e. a `roles/<name>/` directory
//
// The declaration side is a TEXT ORACLE over the project's own admitted files (a manifest with
// `kind: K` and a `metadata:` block naming N; a file path containing `roles/<name>/`), NOT the
// analyzer's key space — an instrument that reuses the thing it is testing can never refute it.
//
//   BB_ONLY_REPOS=kubernetes,ansible,... npx tsx validation/m14/fixtures/yaml/name-collision-falsifier.ts
//
const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { classifyEdge, externalClaimOf, isContainsEdge } = await import(`${REPO}/script/m14/incoming-rule.ts`)
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, readdirSync } from "node:fs"
import { join } from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = [".yaml", ".yml"]
const ONLY = (process.env.BB_ONLY_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean)

/** The k8s kind a REFERRING KEY asks for. Keyed by the leaf of the edge's own source path. */
// THE KIND MAP IS IMPORTED, NOT DUPLICATED. This table decides which edges the rule can reach, so a
// copy here and a copy in the analyzer would be two rules — and the one that drifted would be the
// one doing the pricing. `KIND_FOR_RESOURCE_KEY` is the analyzer's own, exported for exactly this.
const { RealYamlAnalyzer } = await import(`${REPO}/src/ast/real-yaml-analyzer.ts`)
const KEY_KIND: Record<string, string> = RealYamlAnalyzer.KIND_FOR_RESOURCE_KEY
const ROLE_KEYS = new Set(["include_role", "import_role"])

const perRepo = new Map<string, { root: string; files: string[] }>()
for (const name of readdirSync(CR).sort()) {
  if (ONLY.length > 0 && !ONLY.includes(name)) continue
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    if (!EXTS.some((e) => rel.toLowerCase().endsWith(e))) continue
    const abs = join(dir, rel)
    try { if (statSync(abs).size > SIZE_CAP) continue } catch { continue }
    files.push(abs)
  }
  if (files.length > 0) perRepo.set(name, { root: dir, files })
}

let totalAmb = 0, sameDirHit = 0, elsewhereHit = 0, roleMatched = 0
let noReferent = 0, roleKeyNoDir = 0, kindUnknown = 0, kindNoReferent = 0
/** THE PRICE OF THE RULE the falsified edge asks for. `ceiling` = ambiguous edges a
 *  SAME-DIRECTORY + KIND-MAPPED resolution could reach; `controlMulti` = of those, how many sit in
 *  a directory that declares the same kind+name TWICE (the rule would be ambiguous there too — a
 *  mis-bind waiting); `widerRuleWouldBind` = edges a PROJECT-WIDE version of the rule would bind,
 *  which directory scoping deliberately refuses (another manifest set is another cluster). */
let ceiling = 0, controlMulti = 0, widerRuleWouldBind = 0
const ceilingRows: string[] = []
const rows: string[] = []
const dirOf = (rel: string): string => { const c = rel.lastIndexOf("/"); return c >= 0 ? rel.slice(0, c) : "" }

for (const [repo, { root, files }] of perRepo) {
  // ---- the DECLARATION side: text oracle over the project's own admitted files ---------------
  /** `${Kind}|${name}` -> EVERY file that declares it. ONE file was enough for a boolean verdict
   *  ("is there a same-directory referent?") and is NOT enough for a PRICE: a rule whose ceiling is
   *  "how many edges could it reach" has to see every declaration, or a second same-kind name in
   *  another directory can hide behind the first one recorded. */
  const manifest = new Map<string, string[]>()
  const roleDirs = new Set<string>()
  for (const abs of files) {
    const rel = abs.slice(root.length + 1).split("\\").join("/")
    const rm = rel.match(/(?:^|\/)roles\/([^/]+)\//)
    if (rm) roleDirs.add(rm[1])
    let text = ""
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (!/^\s*kind:/m.test(text)) continue
    const km = text.match(/^\s*kind:\s*["']?([A-Za-z][\w.-]*)["']?\s*$/m)
    if (!km) continue
    const mi = text.search(/^\s*metadata:\s*$/m)
    const head = mi >= 0 ? text.slice(mi) : text
    const nm = head.match(/^\s+name:\s*["']?([^"'\n#]+?)["']?\s*$/m)
    if (!nm) continue
    const mk = `${km[1]}|${nm[1]}`
    const list = manifest.get(mk)
    if (list) { if (!list.includes(rel)) list.push(rel) } else manifest.set(mk, [rel])
  }

  // ---- the EDGE side: the arbiter's own rule, over this project's own key space ---------------
  const projectDecl = new Map<string, number>()
  const projectKinds = new Map<string, Set<string>>()
  const pending: { e: any; abs: string }[] = []
  for (const abs of files) {
    let r: any
    try { r = await parseFile(abs, root, { projectRoot: root }) } catch { continue }
    if (!r) continue
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      const kind = String(s?.kind ?? "")
      const add = (k: string) => {
        projectDecl.set(k, (projectDecl.get(k) ?? 0) + 1)
        let ks = projectKinds.get(k); if (!ks) projectKinds.set(k, (ks = new Set())); ks.add(kind)
      }
      add(name)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) add(q)
    }
    for (const e of r.relationships ?? []) pending.push({ e, abs })
  }
  const admittedRel = new Set(files.map((abs) => abs.slice(root.length + 1).split("\\").join("/")))
  const facts = { packages: new Set<string>(), files: admittedRel, sdkLib: false }

  type Group = { type: string; target: string; decls: number; n: number; sources: Map<string, number>; dirs: Set<string>; roleKey: boolean }
  const byTarget = new Map<string, Group>()
  for (const { e, abs } of pending) {
    const type = String(e.type ?? "")
    const tgt = String(e.target ?? e.to ?? e.toSymbol ?? "")
    if (tgt.length === 0) continue
    // THE GATE'S OWN COUNTING RULE, INCLUDING ITS `contains` PREDICATE. `classifyEdge` takes the
    // caller's `containsLike` sixth: production resolves a containment with its own
    // `WHERE s.project_id = ? AND s.name = ? ORDER BY (s.file_id = ?) DESC LIMIT 1` statement, which
    // has no "N candidates" state. Calling this WITHOUT the flag left the falsifier on the retired
    // declaration-count model and made it read `141 ambiguous` where the gate reads 137 — the same
    // four-edge lag the ENUMERATOR had, in the second instrument, which is what "retire the caveat by
    // construction" means: fix the pair, not the one that was noticed.
    const c = classifyEdge(projectDecl, projectKinds, tgt, externalClaimOf(e), facts, isContainsEdge(type))
    if (c.outcome !== "ambDeclOnly" && c.outcome !== "ambBoth") continue
    const src = String(e.source ?? "")
    const key = src.slice(src.lastIndexOf(".") + 1)
    const b = byTarget.get(`${type}\0${tgt}`) ?? { type, target: tgt, decls: c.decls, n: 0, sources: new Map<string, number>(), dirs: new Set<string>(), roleKey: false }
    b.n++
    b.sources.set(key, (b.sources.get(key) ?? 0) + 1)
    b.dirs.add(dirOf(abs.slice(root.length + 1).split("\\").join("/")))
    if (ROLE_KEYS.has(key)) b.roleKey = true
    else if (!(key in KEY_KIND)) {
      // the kind may sit on an ANCESTOR segment (`spec.volumes[5].secret.secretName`)
      for (const seg of src.split(".")) if (seg in KEY_KIND) { b.sources.set(`^${seg}`, (b.sources.get(`^${seg}`) ?? 0) + 1); break }
    }
    byTarget.set(`${type}\0${tgt}`, b)
  }

  for (const b of [...byTarget.values()].sort((x, y) => y.n - x.n)) {
    totalAmb += b.n
    const keys = [...b.sources.keys()].join(",")
    const kinds = new Set<string>()
    for (const k of b.sources.keys()) {
      const leaf = k.startsWith("^") ? k.slice(1) : k
      if (leaf in KEY_KIND) kinds.add(KEY_KIND[leaf])
    }
    // THE SCOPED FALSIFIER. A same-kind declaration in an UNRELATED directory is NOT evidence
    // that it is this edge's referent — two k8s manifest sets are two clusters, and a Service
    // Account named `test` in another fixture tree says nothing about this Pod's volume. Only a
    // referent in the SAME DIRECTORY (one manifest set, what a `kubectl apply -f <dir>` would
    // read) can refute the ruling, and that case is reported separately and cannot be excused.
    const sameDir: string[] = []
    const elsewhere: string[] = []
    let sameDirInOneDir = 0
    for (const K of kinds) {
      const hits = manifest.get(`${K}|${b.target}`) ?? []
      let inDir = 0
      for (const hit of hits) {
        if (b.dirs.has(dirOf(hit))) { inDir++; sameDir.push(`${K} -> ${hit} (dir ${dirOf(hit) || "."})`) }
        else elsewhere.push(`${K} -> ${hit} (dir ${dirOf(hit) || "."})`)
      }
      if (inDir > 1) sameDirInOneDir += inDir
    }
    if (sameDir.length > 0) {
      ceiling += b.n
      if (sameDirInOneDir > 1) controlMulti += b.n
      else ceilingRows.push(`  ${b.n} edge(s) target="${b.target}" kinds=${[...kinds].join("|")} -> ${sameDir.join("; ")}`)
    }
    if (sameDir.length === 0 && elsewhere.length > 0) widerRuleWouldBind += b.n
    const roleHit = b.roleKey && roleDirs.has(b.target)
    if (sameDir.length > 0) sameDirHit += b.n
    else if (elsewhere.length > 0) elsewhereHit += b.n
    if (roleHit) roleMatched += b.n
    if (sameDir.length === 0 && elsewhere.length === 0 && !roleHit) {
      noReferent += b.n
      if (b.roleKey) roleKeyNoDir += b.n
      else if (kinds.size === 0) kindUnknown += b.n
      else kindNoReferent += b.n
    }
    const verdict = sameDir.length > 0
      ? `FALSIFIED (same directory): ${sameDir.join("; ")}`
      : roleHit
        ? `FALSIFIED (role directory): roles/${b.target}/`
        : elsewhere.length > 0
          ? `same-kind name elsewhere, NOT this referent: ${elsewhere.join("; ")}`
          : "no same-kind referent"
    rows.push(
      `  ${String(b.n).padStart(4)}  ${String(b.type).padEnd(11)} target=${JSON.stringify(b.target).padEnd(14)} decls=${String(b.decls).padEnd(4)} ` +
      `nDirs=${String(b.dirs.size).padEnd(4)} kinds=${(kinds.size ? [...kinds].join("|") : "(none)").padEnd(22)} keys=${keys.padEnd(26)} ${verdict}`,
    )
  }
}

console.log(`repos: ${[...perRepo.keys()].join(", ")}`)
console.log(`\n=== AMBIGUOUS EDGES BY TARGET, with the SAME-KIND FALSIFIER ===`)
for (const r of rows) console.log(r)
console.log(`\n=== THE PRICE OF THE ONE-EDGE RULE (same-directory + kind-mapped) ===`)
console.log(`  CEILING  ${ceiling} ambiguous edge(s) a same-directory, same-kind resolution could reach`)
for (const r of ceilingRows) console.log(r)
console.log(`  CONTROL  ${controlMulti} of them sit in a directory declaring that kind+name TWICE (the rule would be ambiguous there too)`)
console.log(`  CONTROL  ${widerRuleWouldBind} more would be bound by a PROJECT-WIDE version of the rule — refused by the directory scope`)
console.log(`  => ${ceiling > 0 && controlMulti === 0 ? "CLEAN: apply the rule" : "NOT CLEAN or empty"}`)

console.log(`\nFALSIFIER TOTALS over ${totalAmb} ambiguous edges:`)
console.log(`  ${sameDirHit}  FALSIFIED — a SAME-KIND, SAME-NAME declaration sits in the referring file's own directory (a missed resolution)`)
console.log(`  ${roleMatched}  FALSIFIED — a role directory ` + "`roles/<name>/`" + ` exists in the project`)
console.log(`  ${elsewhereHit}  same-kind name exists ELSEWHERE in the project (not evidence of this referent: another manifest set is another cluster)`)
console.log(`  ${noReferent}  no same-kind referent at all (the target collides only with ordinary keys), splitting:`)
console.log(`      ${roleKeyNoDir}  an ansible ROLE import whose ` + "`roles/<name>/`" + ` directory the project does not have`)
console.log(`      ${kindNoReferent}  a kind was asked for and the project declares no such object`)
console.log(`      ${kindUnknown}  no kind axis on the referring key (the generic count model, not this ruling)`)
void 0
console.log(`RULING ${sameDirHit + roleMatched === 0 ? "HOLDS on this population" : "FAILS on " + (sameDirHit + roleMatched) + " edge(s) and must be corrected"}.`)
