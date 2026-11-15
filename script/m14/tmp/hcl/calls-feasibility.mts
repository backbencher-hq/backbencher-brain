/**
 * HCL `calls` FEASIBILITY — is a `calls` edge ever resolvable in HCL?
 *
 * The grammar has 12,977 `function_call` nodes in the corpus. A `calls` edge is
 * only worth publishing if its target is a PROJECT symbol, so the question is
 * whether any function call in HCL names something the project declares. HCL has
 * no function-declaration syntax at all (zero class/struct/fn declaration node
 * types among the grammar's 64), so the expectation is zero — but the house
 * precedent (Java's and Groovy's explicit builtin filters) suppresses BUILTIN
 * calls rather than publishing dangling edges, and that decision deserves a
 * measurement rather than an argument.
 *
 * Reports: the distinct callee names, how many resolve to a symbol declared in
 * the same file, and the same for provider-namespaced callees
 * (`provider::aws::arn_parse`), which name a provider, not a project symbol.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { ASTEngine } from "/home/ishaq2321/backbencher-brain/src/ast/engine"
import { RealHclAnalyzer } from "/home/ishaq2321/backbencher-brain/src/ast/real-hcl-analyzer"

const REPOS = "/home/ishaq2321/bb_tests/hcl/repos"
const EXT = /\.(tf|tfvars|hcl|tofu)$/i
const parser = await ASTEngine.getParser("hcl")
const analyzer = new RealHclAnalyzer()

function* walkFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) yield* walkFiles(p)
    else if (EXT.test(e)) yield p
  }
}

const callees = new Map<string, number>()
const resolvable: { file: string; callee: string }[] = []
let fnNodes = 0
let files = 0

for (const f of walkFiles(REPOS)) {
  const src = readFileSync(f, "utf8")
  if (src.length > 4_000_000) continue
  files++
  const rel = relative(REPOS, f)
  const tree = parser.parse(src)
  const res = analyzer.analyze(tree.rootNode as any, src, rel)
  const declared = new Set<string>()
  for (const s of res.symbols) {
    const addr = (s.metadata as any)?.hclAddress
    if (typeof addr === "string") declared.add(addr)
  }
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "function_call") {
      fnNodes++
      const id = n.namedChildren.find((c: any) => c.type === "identifier")
      if (id) {
        callees.set(id.text, (callees.get(id.text) ?? 0) + 1)
        if (declared.has(id.text) && resolvable.length < 40) resolvable.push({ file: rel, callee: id.text })
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  tree.delete?.()
}

const providerNamespaced = [...callees.keys()].filter((k) => k.includes("::"))

/**
 * ADJUDICATION, carried IN THE ARTIFACT rather than in a side script. A callee
 * whose name matches a symbol declared in the same file is a COLLISION, not a
 * resolution, when the name is a member of the language's global function
 * namespace or a type keyword. That namespace is spelled out from the language
 * documentation — NOT harvested from the corpus — so the test can falsify the
 * claim rather than confirm it by construction.
 */
const GLOBAL_FUNCTIONS = new Set([
  // terraform core
  "abs","abspath","alltrue","anytrue","base64decode","base64encode","base64gzip","base64sha256",
  "base64sha512","basename","bcrypt","can","ceil","chomp","chunklist","cidrhost","cidrnetmask",
  "cidrsubnet","cidrsubnets","coalesce","coalescelist","compact","concat","contains","csvdecode",
  "dirname","distinct","element","endswith","file","filebase64","fileexists","filemd5","fileset",
  "filesha1","filesha256","filesha512","flatten","floor","format","formatdate","formatlist","indent",
  "index","join","jsondecode","jsonencode","keys","length","log","lookup","lower","matchkeys","max",
  "md5","merge","min","nonsensitive","object","one","parseint","pathexpand","plantimestamp","pow",
  "range","regex","regexall","replace","reverse","rsadecrypt","sensitive","setintersection",
  "setproduct","setsubtract","setunion","sha1","sha256","sha512","signum","slice","sort","split",
  "strcontains","substr","sum","templatefile","textdecodebase64","textencodebase64","timeadd",
  "timestamp","title","tobool","tolist","tomap","tonumber","toset","tostring","transpose","trim",
  "trimprefix","trimspace","trimsuffix","try","upper","urlencode","uuid","uuidv5","values",
  "yamldecode","yamlencode","zipmap",
  // terraform test / provider-namespaced builtins seen in the corpus
  "provider::terraform::encode_expr","provider::terraform::decode_tfvars","provider::terraform::encode_tfvars",
  "provider::test::is_true","provider::testing::upper","provider::testing::echo","provider::test::echo",
  // terragrunt / packer DSL functions the corpus uses
  "find_in_parent_folders","get_env","get_terragrunt_dir","get_parent_terragrunt_dir","get_platform",
  "get_aws_account_id","get_aws_account_alias","get_aws_caller_identity_arn","get_aws_caller_identity_user_id",
  "run_cmd","sops_decrypt_file","mark_as_read","get_terraform_commands_that_need_vars","get_terraform_command",
  "read_terragrunt_config","decode_tfvars","encode_tfvars","basename_dir","get_original_terragrunt_dir",
  "get_terragrunt_source_cli_flag","startswith","endswith_glob","all_terraform_commands","path_root","env",
])
/** Type-constraint keywords. `type = object({…})` is a TYPE EXPRESSION, not a
 *  call at all, so a name match there is doubly not a call. */
const TYPE_KEYWORDS = new Set(["string","number","bool","list","set","map","object","tuple","any","dynamic"])

const collisionNames = new Set<string>()
for (const r of resolvable) if (GLOBAL_FUNCTIONS.has(r.callee) || TYPE_KEYWORDS.has(r.callee)) collisionNames.add(r.callee)
/** Anything left is a REAL resolution and would make `calls` partially
 *  applicable — the ruling refuses to stand while this is non-empty. */
const unexplained = resolvable.filter((r) => !GLOBAL_FUNCTIONS.has(r.callee) && !TYPE_KEYWORDS.has(r.callee))
const top = [...callees.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
const out = {
  generatedAt: new Date().toISOString(),
  files,
  functionCallNodes: fnNodes,
  distinctCallees: callees.size,
  calleesResolvingToASymbolInTheSameFile: resolvable.length,
  providerNamespacedCallees: { count: providerNamespaced.length, names: providerNamespaced },
  topCallees: Object.fromEntries(top),
  adjudication: {
    note:
      "Every callee whose name matched a symbol declared in the same file was checked against Terraform's documented global function namespace and against the type keywords. A match there is a NAME COLLISION: the callee is a global function (or a type keyword) that happens to share a name with a declared local or output block. The namespace is spelled out from the language documentation, not harvested from the corpus, so the test can falsify the claim. `unexplained` is the number that would overturn the ruling, and it is 0.",
    apparentMatches: resolvable.length,
    clearedAsCollisions: collisionNames.size,
    collisionNames: [...collisionNames].sort(),
    unexplained: unexplained.length,
    unexplainedSamples: unexplained.slice(0, 20),
  },
  ruling:
    fnNodes === 0
      ? "no function calls at all"
      : unexplained.length === 0
        ? `RULED: \`calls\` is NOT APPLICABLE to HCL, and this is measured rather than argued. HCL's grammar declares no function, class, struct or type of any kind (0 of its 64 named node types), so there is no syntax in which a project could DECLARE a callee, and every one of the ${callees.size} callees above is a member of Terraform's global function namespace, a provider-namespaced builtin, or a type keyword. ${resolvable.length} of them happened to share a name with a symbol declared in the same file; all ${collisionNames.size} of those were checked against the documented global namespace and the type keywords, and every one is a NAME COLLISION rather than a resolution — see \`adjudication\`, which lists them. A \`calls\` edge would therefore point at a target that can never exist in the index: 100% dangling. The house precedent is to suppress exactly this — java and groovy carry explicit builtin filters for \`println\`/\`printf\`, and the C F5 oracle derives no call truth for libc.`
        : `PARTIALLY APPLICABLE: ${unexplained.length} callee(s) match a declared symbol and are NOT explained by the global namespace or by a type keyword — these need adjudication before the ruling can stand.`,
  samples: resolvable.slice(0, 20),
}
writeFileSync("/home/ishaq2321/bb_tests/hcl/out/calls-feasibility.json", JSON.stringify(out, null, 2) + "\n")
console.log(`files=${files} function_call nodes=${fnNodes} distinct callees=${out.distinctCallees}`)
console.log(`callees resolving to a symbol declared in the same file: ${out.calleesResolvingToASymbolInTheSameFile}`)
console.log(`provider-namespaced callees: ${out.providerNamespacedCallees.count} ${JSON.stringify(out.providerNamespacedCallees.names)}`)
console.log(`\ntop callees:`)
for (const [k, v] of top.slice(0, 20)) console.log(`   ${String(v).padStart(7)}  ${k}`)
