// R1 probe: the two OO analyzer regexes removed this round must be
// BEHAVIOUR-IDENTICAL to the expressions they replaced, and the inputs that
// matter are the ones real corpora contain — php qualified heritage names and
// ruby superclass-marker text. Both sides are run over those inputs and any
// disagreement is reported, so the removal is evidence rather than an assertion.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const { phpStripLeadingBackslashes } = await import(path.join(ROOT, "src/ast/real-php-analyzer.ts"))

const listFiles = (d: string, out: string[], ext: string) => {
  let es: fs.Dirent[]
  try {
    es = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of es) {
    const q = path.join(d, e.name)
    if (e.isDirectory()) {
      if (!e.name.startsWith(".") && !["vendor", "node_modules", "build", "target"].includes(e.name)) listFiles(q, out, ext)
    } else if (e.name.endsWith(ext)) out.push(q)
  }
}

// ---- php: replace(/^\\+/, "") ----------------------------------------------
const oldPhp = (raw: string) => raw.replace(/^\\+/, "")
const phpCases = new Set<string>([
  "",
  "\\",
  "\\\\",
  "\\\\\\",
  "Foo",
  "\\Foo",
  "\\\\Foo",
  "\\\\Foo\\Bar",
  "Foo\\Bar",
  "\\Is\\Not\\Empty",
  "\\ LeadingSpace",
])
const phpFiles: string[] = []
for (const repo of ["phpunit", "phpmyadmin"]) listFiles(path.join(CORPUS, repo), phpFiles, ".php")
let phpScanned = 0
for (const f of phpFiles.slice(0, 1200)) {
  const src = fs.readFileSync(f, "utf8")
  for (const m of src.matchAll(/(\\{1,3}[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*)/g)) phpCases.add(m[1])
  phpScanned++
}
let phpBad = 0
for (const c of phpCases) {
  if (oldPhp(c) !== phpStripLeadingBackslashes(c)) {
    phpBad++
    console.log("PHP MISMATCH", JSON.stringify(c), JSON.stringify(oldPhp(c)), JSON.stringify(phpStripLeadingBackslashes(c)))
  }
}
console.log(`php: ${phpCases.size} inputs (incl. every backslash-qualified name in ${phpScanned} real .php files), ${phpBad} mismatch(es)`)

// ---- ruby: replace(/^<\s*/, "") then .trim() -------------------------------
// The expression the analyzer carried, and the char-scan replacement it now runs.
const oldRuby = (t: string) => t.replace(/^<\s*/, "").trim()
const newRuby = (t: string) => {
  let i = 0
  if (t.charCodeAt(0) === 60) i = 1
  while (i < t.length && [32, 9, 10, 13, 12, 11].includes(t.charCodeAt(i))) i++
  return t.substring(i).trim()
}
const rubyCases = new Set<string>([
  "< Foo",
  "<Foo",
  "<  Foo",
  "<\tFoo",
  "<\nFoo",
  "<Foo\n",
  "< Foo::Bar",
  "Foo",
  "<<Foo",
  "<",
  " ",
  "",
  "<  ",
  "< >",
  "<::Foo",
])
// Real superclass-marker texts: the `< Base` tail of every `class X < Base` line
// is exactly the node text this fallback receives.
for (const repo of ["rake", "rack"]) {
  const files: string[] = []
  listFiles(path.join(CORPUS, repo), files, ".rb")
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    for (const line of src.split("\n")) {
      const m = /^\s*class\s+[A-Za-z_][\w:]*\s*(<[^;#]*)/.exec(line)
      if (m && m[1].trim().length > 1) rubyCases.add(m[1])
    }
  }
}
let rubyBad = 0
for (const c of rubyCases) {
  if (oldRuby(c) !== newRuby(c)) {
    rubyBad++
    console.log("RUBY MISMATCH", JSON.stringify(c), JSON.stringify(oldRuby(c)), JSON.stringify(newRuby(c)))
  }
}
console.log(`ruby: ${rubyCases.size} marker shapes (synthetic + every real \`class X < Base\` line in rake/rack), ${rubyBad} mismatch(es)`)
