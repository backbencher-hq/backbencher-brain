/**
 * verify-grammar-licenses.ts — the license gate for vendored Tree-sitter grammars.
 *
 * Every grammar under grammars/ is third-party work; a public checkout and the npm package
 * must carry its license and its provenance. This gate proves, and with --write regenerates:
 *
 *   for each grammar directory
 *     - an upstream license text is present (LICENSE / COPYING / NOTICE…)
 *     - a local-change record is present (PIN.md, PROVENANCE.md or README.md)
 *   grammars/THIRD-PARTY-NOTICES.md
 *     - lists that grammar with package, license, upstream, change record and license file
 *   package.json `files`
 *     - ships the notices and the license texts next to the wasm binaries
 *
 * Usage: npx tsx script/verify-grammar-licenses.ts [--write]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const GRAMMARS = join(ROOT, "grammars")
const NOTICES = join(GRAMMARS, "THIRD-PARTY-NOTICES.md")
const write = process.argv.includes("--write")

const LICENSE_FILE = /^(license|copying|notice)/i
const LICENSE_KINDS = ["Apache-2.0", "MPL-2.0", "LGPL-3.0", "GPL-3.0", "BSD-3-Clause", "BSD-2-Clause", "ISC", "MIT"]

interface Row {
  dir: string
  pkg: string
  version: string
  license: string
  upstream: string
  record: string
  licenseFile: string
}

const failures: string[] = []
function fail(msg: string) {
  failures.push(msg)
}
function licenseKind(text: string | undefined): string {
  if (!text) return "see license file"
  const upper = text.toUpperCase()
  for (const k of LICENSE_KINDS) if (upper.includes(k.toUpperCase())) return k
  if (/MIT LICENSE/i.test(text)) return "MIT"
  return "see license file"
}
function normalizeUpstream(raw: string): string {
  // package metadata spelling varies (git+https, git://, github:owner/repo); the notice
  // should always show a clickable canonical URL.
  let url = raw.trim()
  if (url.startsWith("github:")) url = `https://github.com/${url.slice("github:".length)}`
  if (url.startsWith("git+")) url = url.slice(4)
  if (url.startsWith("git://")) url = `https://${url.slice("git://".length)}`
  if (url.startsWith("github.com/")) url = `https://${url}`
  return url.replace(/\.git$/, "")
}
function firstUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s)>\]]+/)?.[0]
}

const dirs = readdirSync(GRAMMARS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_vendored")
  .map((d) => d.name)
  .sort()

const rows: Row[] = []
for (const dir of dirs) {
  const base = join(GRAMMARS, dir)
  const files = readdirSync(base)
  const licenseFile = files.find((f) => LICENSE_FILE.test(f))
  if (!licenseFile) fail(`${dir}: no license text (LICENSE/COPYING/NOTICE)`)
  const record = ["PIN.md", "PROVENANCE.md", "README.md"].find((f) => existsSync(join(base, f)))
  if (!record) fail(`${dir}: no local-change record (PIN.md, PROVENANCE.md or README.md)`)
  let pkg: { name?: string; version?: string; license?: string; repository?: unknown } = {}
  if (existsSync(join(base, "package.json"))) {
    try {
      pkg = JSON.parse(readFileSync(join(base, "package.json"), "utf8"))
    } catch (e) {
      fail(`${dir}: package.json is not valid JSON (${(e as Error).message})`)
    }
  }
  const licenseText = licenseFile ? readFileSync(join(base, licenseFile), "utf8") : undefined
  const license = pkg.license ?? licenseKind(licenseText)
  const repository = pkg.repository
  const repoUrl =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object" && "url" in repository
        ? String((repository as { url?: string }).url ?? "")
        : ""
  const recordText = record ? readFileSync(join(base, record), "utf8") : ""
  rows.push({
    dir,
    pkg: pkg.name ?? dir,
    version: pkg.version ?? "not stated",
    license,
    upstream: normalizeUpstream(repoUrl || firstUrl(recordText) || "not declared by the upstream package"),
    record: record ?? "missing",
    licenseFile: licenseFile ?? "missing",
  })
}

const table = [
  "| grammar | package | license | upstream | local changes | license file |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (r) => `| \`${r.dir}\` | ${r.pkg} ${r.version === "not stated" ? "" : r.version} | ${r.license} | ${r.upstream} | ${r.record} | ${r.licenseFile} |`.replace(/ {2,}/g, " "),
  ),
]

const expected = `# Third-party grammar notices

Every directory under \`grammars/\` (except \`_vendored/\`) is third-party work redistributed
under its own license. This file records, per grammar: the package the source came from, the
license it declares, the upstream project, where the local-change record lives, and the license
text kept beside the source. The license texts and this notice are shipped in the npm package next
to the wasm binaries.

${table.join("\n")}

\`grammars/_vendored/\` is not a grammar: it holds this project's own preserved measurements and
repro materials, described in \`_vendored/VENDORED.md\`.

If you are a grammar author or maintainer and an attribution or license record here does not match
your intent, open an issue in this repository; correction is the fastest fix we can make.
`

if (write) {
  writeFileSync(NOTICES, expected)
  console.log(`wrote ${NOTICES} (${rows.length} grammars)`)
} else {
  const current = existsSync(NOTICES) ? readFileSync(NOTICES, "utf8") : ""
  if (current !== expected) fail("grammars/THIRD-PARTY-NOTICES.md is stale — run with --write")
  for (const r of rows) if (!current.includes(`\`${r.dir}\``)) fail(`notices do not list ${r.dir}`)
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { files?: string[] }
  const required = ["grammars/README.md", "grammars/THIRD-PARTY-NOTICES.md", "grammars/*/LICENSE*"]
  for (const entry of required) {
    if (!pkg.files?.includes(entry)) fail(`package.json files is missing ${entry}`)
  }
}

const withLicense = rows.filter((r) => r.licenseFile !== "missing").length
const withRecord = rows.filter((r) => r.record !== "missing").length
console.log(`grammars: ${rows.length} · license text: ${withLicense}/${rows.length} · change record: ${withRecord}/${rows.length}`)
if (failures.length) {
  console.log("VERDICT: FAIL")
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log("VERDICT: PASS")
