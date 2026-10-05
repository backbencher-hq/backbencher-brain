/**
 * PROTOBUF LANE — extension-field identity, adjudicated by protoc.
 *
 * ## The defect this file finds
 *
 * This analyzer publishes an `extend Foo { … }` member under `Foo.<name>`. `protoc` does
 * not: an extension field's identity is **its own package plus its own name**, and the
 * extendee is a SEPARATE descriptor field (`FieldDescriptorProto.extendee`), not part of
 * the name. Read straight out of a `FileDescriptorProto` produced by libprotoc 36.2 for
 * three files in this corpus:
 *
 *     file                              package             extendee                        protoc's `name`
 *     unittest_custom_features.proto    custom_features    .google.protobuf.FeatureSet      test     (9995)
 *     unittest_features.proto           pb                 .google.protobuf.FeatureSet      test     (9999)
 *     unittest_custom_options.proto     proto2_unittest    .google.protobuf.MessageOptions  custom_option_lifetimes_message (7737026)
 *
 * The two `test` extensions are `custom_features.test` and `pb.test` — DIFFERENT
 * symbols, which is why `protoc` compiles all three files together without complaint.
 * (Run it: exit 0.) This analyzer publishes BOTH as `google.protobuf.FeatureSet.test`, so
 * two files in one repository collide on one id, and the collision is the analyzer's.
 *
 * ## Why `protoc` accepts and the analyzer does not
 *
 * The published-name convention is wrong in a way that is invisible to the lane's own
 * `contains` oracle, because `script/m14/tmp/protobuf/probe/protoc-descriptor-oracle.py`
 * states convention 4 in its own header: "AN EXTENSION MEMBER BELONGS TO ITS EXTENDEE …
 * Both sides key on the extendee." An oracle that adopts the convention under test agrees
 * by construction, and that header names the hazard explicitly. So the `contains` rate of
 * 36,022/37,042 cannot see this, and this file exists to be a second opinion that does
 * not.
 *
 * ## What is measured
 *
 *   rows                 every extension member in the corpus, from BOTH sides
 *   agrees               analyzer id == `<own package>.<name>`
 *   disagreeExtendee     analyzer id == `<extendee>.<name>`  — the defect
 *   distinctIdsCollide   ids where TWO files publish the same id, split by whether
 *                        protoc says the two extensions are distinct symbols
 *
 * The second half is the price in ambiguity terms, because the round brief's question is
 * what the reverse walk picks between.
 *
 * ## What is NOT claimed
 *
 * This does NOT change the analyzer. The fix is not obviously right: `extendee.field` is
 * what makes the edge walkable (the extendee is the declaration a consumer wants), and
 * `<own package>.<name>` is what makes the id sound. Both facts are true and they are
 * different facts, and the shape that carries both — the extension's own id on the
 * SYMBOL with the extendee on the EDGE's `member`/`viaExtension` — is a change to this
 * lane's published-name contract, which changes every id a downstream consumer already
 * stored. So it is priced here and reported, not landed here. The measurement that would
 * justify landing it is in §8.
 *
 * ## No regex
 *
 * Package is read from the `package` node via the analyzer's own `Namespace` symbol, not
 * by matching a line of source; extension members are read off `parseFile` output and off
 * protoc's decoded descriptor. No source text is pattern-matched.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const PROTOC = process.env.PB_PROTOC ?? "/tmp/opencode/protoc-36/bin/protoc"
/** protoc's own bundled well-known-types root, derived from PROTOC so the two cannot drift. */
const PROTOC_INCLUDE = path.join(path.dirname(path.dirname(PROTOC)), "include")
const OUT = process.env.BB_OUT ?? "/tmp/opencode/pb/extension-identity.json"

type Row = {
  file: string
  rel: string
  analyzerId: string
  extendee: string
  ownName: string
  pkg: string
  expectedOwnPackageId: string
  agree: boolean
  protocName: string | null
  protocExtendee: string | null
  protocNumber: number | null
}

function walk(dir: string, out: string[], symlinks: { n: number }): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isSymbolicLink()) {
      symlinks.n++
      continue
    }
    if (e.isDirectory()) walk(full, out, symlinks)
    else if (e.isFile() && e.name.endsWith(".proto")) out.push(full)
  }
}

type ExtRec = { name: string; extendee: string; number: number | null }

/**
 * protoc's `--decode` output for a `FileDescriptorSet`, read for its `extension { … }`
 * blocks by BRACE DEPTH rather than by indentation.
 *
 * protoc's text form is one field per line, one block header per line (`field {`) and one
 * bare `}` per block close. Indentation tracks nesting but its WIDTH is not part of the
 * format: a top-level `extension`'s `name:` sits at six spaces and a nested one's at
 * eight, in the same file and the same run. Reading at a hardcoded indent therefore matches
 * nothing at all and reports zero, which is the failure this replaces.
 *
 * Not a regex and not a source-text match: the input is protoc's own canonical
 * serialization of a descriptor, walked with its own structure. Every branch that yields a
 * record requires a `name:` AND an `extendee:` at the extension's own depth, so a
 * malformed block is skipped rather than half-read.
 */
function readExtensions(decoded: string): ExtRec[] {
  const out: ExtRec[] = []
  let depth = 0
  let extDepth = -1
  let name = ""
  let extendee = ""
  let number: number | null = null
  const closeExtension = (): void => {
    if (name !== "" && extendee !== "") {
      // protoc writes extendee fully qualified with a LEADING DOT; the analyzer's id has
      // no dot, so strip exactly one leading dot rather than matching a shape.
      out.push({ name, extendee: extendee.startsWith(".") ? extendee.slice(1) : extendee, number })
    }
    extDepth = -1
    name = ""
    extendee = ""
    number = null
  }
  for (const line of decoded.split("\n")) {
    const t = line.trim()
    if (t === "}") {
      if (extDepth >= 0 && depth === extDepth + 1) closeExtension()
      depth--
      continue
    }
    if (t.endsWith("{")) {
      // `.trim()` after dropping the brace, not before: the header is `<name> {` with a
      // SPACE before the brace, so `slice(0, -1)` alone leaves `extension ` — a key that
      // never equals `"extension"`, so no block was ever entered and the reader reported 0
      // on a file protoc had compiled successfully. A unit check on protoc's own output
      // caught it before the census ran; see `selftest` below.
      const key = t.slice(0, t.length - 1).trim()
      // A block header is a bare identifier. A line ending in `{` that also carries a `:`
      // is a STRING VALUE whose text happens to end in a brace, and must not open a block —
      // `default: "{"` is the shape. Counting it would corrupt every depth after it.
      if (key.includes(":") || key.includes("\"")) continue
      if (key === "extension" && extDepth < 0) {
        extDepth = depth
        name = ""
        extendee = ""
        number = null
      }
      depth++
      continue
    }
    if (extDepth < 0 || depth !== extDepth + 1) continue
    const colon = t.indexOf(":")
    if (colon <= 0) continue
    const key = t.slice(0, colon)
    let value = t.slice(colon + 1).trim()
    if (value.startsWith("\"")) value = value.slice(1, value.endsWith("\"") ? value.length - 1 : value.length)
    if (key === "name") name = value
    else if (key === "extendee") extendee = value
    else if (key === "number") {
      const n = Number(value)
      number = Number.isFinite(n) ? n : null
    }
  }
  return out
}

/**
 * The probe's own reader, checked against protoc before the census is allowed to report
 * anything.
 *
 * This probe's headline is a COUNT, and two of its three defects produced a plausible zero
 * (`protocOk 46, protocVerified 0`) by reading nothing. A count is only worth reporting if
 * the instrument can be shown to read something on a case where the answer is known, so this
 * compiles a synthetic `.proto` whose extensions sit at all three nesting levels protoc can
 * put them — top level of a file, inside a message, and inside a message nested in a
 * message — asserts the reader's own count against protoc's, and exits non-zero on a
 * mismatch.
 *
 * Known-answer on purpose: the names are spelled so a reader that matched on the wrong field,
 * or at the wrong depth, would produce a DIFFERENT number rather than accidentally the right
 * one. The three indents are 4, 6 and 8 spaces, which is where the first two defects lived.
 */
function selftest(): void {
  const src = [
    'syntax = "proto2";',
    "package selftest.pkg;",
    'import "google/protobuf/descriptor.proto";',
    "message Outer {",
    "  message Inner {",
    "    extend google.protobuf.MessageOptions {",
    "      optional string deep = 6001;",
    "    }",
    "  }",
    "  extend google.protobuf.MessageOptions {",
    "    optional string middle = 6002;",
    "  }",
    "}",
    "extend google.protobuf.MessageOptions {",
    "  optional string top = 6003;",
    "}",
  ].join("\n")
  const tmp = fs.mkdtempSync("/tmp/opencode/pbst-")
  try {
    const f = path.join(tmp, "selftest.proto")
    fs.writeFileSync(f, src)
    const set = path.join(tmp, "fs.pb")
    execFileSync(
      PROTOC,
      ["--include_imports", `--descriptor_set_out=${set}`, `-I${tmp}`, `-I${PROTOC_INCLUDE}`, "selftest.proto"],
      { stdio: ["ignore", "ignore", "pipe"], cwd: tmp },
    )
    const decoded = execFileSync(
      PROTOC,
      ["--decode=google.protobuf.FileDescriptorSet", `-I${PROTOC_INCLUDE}`, "google/protobuf/descriptor.proto"],
      { input: fs.readFileSync(set), maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"] },
    ).toString()
    // protoc's own count of the blocks it wrote, read structurally rather than by the
    // reader's depth logic: a header line that is exactly `extension {`. This is the same
    // trigger the reader uses, so it is NOT an independent oracle — the KNOWN ANSWER below
    // is the planted names and numbers, which are facts about the input file and are
    // asserted independently of any parse.
    const headers = decoded.split("\n").filter((l) => l.trim() === "extension {").length
    const got = readExtensions(decoded)
    const wantNames = ["top", "middle", "deep"]
    const wantNumbers = [6001, 6002, 6003]
    const gotNames = got.map((g) => g.name).filter((n) => wantNames.includes(n))
    const gotNumbers = got.map((g) => g.number).sort((a, b) => (a ?? 0) - (b ?? 0))
    const ok =
      got.length === wantNames.length &&
      wantNames.every((n) => gotNames.includes(n)) &&
      wantNumbers.every((n, i) => gotNumbers[i] === n) &&
      got.every((g) => g.extendee === "google.protobuf.MessageOptions")
    console.log(`\nSELFTEST — protoc's own output for a synthetic file, extensions at indents 4/6/8`)
    console.log(`  extension block headers protoc wrote       ${headers}`)
    console.log(`  blocks this reader read                     ${got.length}`)
    console.log(`  planted names read back (want 3)            ${gotNames.sort().join(", ") || "(none)"}`)
    console.log(`  numbers read (want 6001,6002,6003)          ${gotNumbers.join(", ") || "(none)"}`)
    console.log(`  extendees read (want all MessageOptions)    ${[...new Set(got.map((g) => g.extendee))].join(", ") || "(none)"}`)
    console.log(`  ${ok ? "PASS" : "FAIL"}`)
    if (!ok) {
      console.error(`\nSELFTEST FAILED — the reader does not read protoc's output, so every count below would be a failure to measure.`)
      process.exit(1)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (process.env.PB_SELFTEST_ONLY === "1") {
    selftest()
    return
  }
  selftest()
  const files: string[] = []
  const symlinks = { n: 0 }
  walk(CORPUS, files, symlinks)
  files.sort()

  const rows: Row[] = []
  let parsed = 0
  let failed = 0

  for (const f of files) {
    let prod: any
    try {
      prod = await parseFile(f, "protobuf")
    } catch {
      failed++
      continue
    }
    parsed++

    // The file's own package, read off the analyzer's `namespace` symbol rather than by
    // matching a `package` line.
    let pkg = ""
    for (const s of (prod.symbols ?? []) as any[]) {
      if (String(s.kind) === "namespace" && String(s.qualifiedName ?? "") === String(s.name ?? "")) {
        pkg = String(s.name ?? "")
        break
      }
    }

    // Every extension member: a `contains` edge into a type the file did not declare
    // itself, carrying `viaExtension`. `viaExtension` is the analyzer's own marker and
    // is set on both the symbol and the edge.
    for (const e of (prod.relationships ?? []) as any[]) {
      const meta = e.metadata ?? {}
      if (String(e.type) !== "contains") continue
      if (meta.viaExtension !== true) continue
      const target = String(e.target ?? "")
      const owner = String(e.source ?? "")
      if (owner === "") continue
      // The member's own name is the last dotted segment of the id the analyzer published.
      const i = target.lastIndexOf(".")
      const ownName = i <= 0 ? target : target.slice(i + 1)
      // Skip the `#property` suffix uniqueId appends for a group's field/type pair.
      const clean = ownName.split("#")[0]!
      const cleanOwner = owner.split("#")[0]!
      const expectedOwnPackageId = pkg === "" ? clean : `${pkg}.${clean}`
      rows.push({
        file: f,
        rel: path.relative(CORPUS, f),
        analyzerId: target,
        extendee: cleanOwner,
        ownName: clean,
        pkg,
        expectedOwnPackageId,
        agree: target === expectedOwnPackageId,
        protocName: null,
        protocExtendee: null,
        protocNumber: null,
      })
    }
  }

// protoc's own names, per file, by decoding the FileDescriptorSet it produces. This
  // shares no code with the analyzer: it is the C++ reference implementation's output,
  // decoded through protoc's own descriptor.proto.
  let protocOk = 0
  let protocBlocks = 0
  let protocRejected = 0
  const rejectReasons = new Map<string, number>()
  const byKey = new Map<string, Row[]>()
  for (const r of rows) {
    const k = `${r.file}\0${r.extendee}\0${r.ownName}`
    const arr = byKey.get(k) ?? []
    arr.push(r)
    byKey.set(k, arr)
  }
  let protocMissing = 0
  for (const f of files) {
    const mine = rows.filter((r) => r.file === f)
    if (mine.length === 0) continue
    const tmp = fs.mkdtempSync("/tmp/opencode/pbx-")
    const set = path.join(tmp, "fs.pb")
    try {
      // The file is passed to protoc by its path RELATIVE TO THE CORPUS ROOT, with cwd
      // set to the corpus root and `-I` naming the same root. An earlier version passed
      // `path.relative(process.cwd(), f)` — which is a `../../..` chain out of the
      // worktree — and protoc rejected all 64 files with "Could not make proto path
      // relative". The probe then printed `protoc compiled the file and read the
      // extension 0 rows` and `protoc sees distinct symbols 0`, i.e. a FAILURE TO MEASURE
      // dressed as a clean result: zero collisions found by an instrument that read
      // nothing. Any probe whose headline is a zero must print the population it read, and
      // this one now prints both, which is what made the bug visible.
      //
      // A SECOND zero of the same shape was in the decode step and survived that fix. The
      // reader split on the literal block header `extension {` and then took the fields at
      // a HARDCODED TWO-SPACE indent — and protoc indents a top-level extension's `name:`
      // by six spaces and a nested one by eight, so the field patterns matched nothing on
      // every one of the 46 files it compiled. `protocOk 46, protocVerified 0` is the
      // signature. Indentation is not a fact about the data, so the reader now tracks
      // BRACE DEPTH and reads fields at `extDepth + 1` (see `readExtensions`).
      const relToCorpus = path.relative(CORPUS, f)
      execFileSync(
        PROTOC,
        ["--include_imports", `--descriptor_set_out=${set}`, `-I${CORPUS}`, `-I${PROTOC_INCLUDE}`, relToCorpus],
        { stdio: ["ignore", "ignore", "pipe"], cwd: CORPUS },
      )
      const decoded = execFileSync(
        PROTOC,
        [
          "--decode=google.protobuf.FileDescriptorSet",
          `-I${PROTOC_INCLUDE}`,
          "google/protobuf/descriptor.proto",
        ],
        { input: fs.readFileSync(set), maxBuffer: 1 << 28, stdio: ["pipe", "pipe", "pipe"] },
      ).toString()
      protocOk++
      // `PROTOC_INCLUDE` is protoc's own bundled well-known-types root, added as a
      // SECOND include root after the corpus. Without it 18 of the 64 files were rejected
      // for a missing `google/protobuf/unittest_import.proto` and were silently scored as
      // "no collision". The corpus root stays FIRST, so a `google/protobuf/descriptor.proto`
      // the corpus actually ships is the one protoc reads.
      const exts = readExtensions(decoded)
      protocBlocks += exts.length
      for (const e of exts) {
        const hit = byKey.get(`${f}\0${e.extendee}\0${e.name}`)
        if (!hit || hit.length === 0) continue
        for (const r of hit) {
          r.protocName = e.name
          r.protocExtendee = e.extendee
          r.protocNumber = e.number
        }
      }
      for (const r of mine) if (r.protocName === null) protocMissing++
    } catch (e: any) {
      protocRejected++
      const msg = String(e?.stderr ?? "").split("\n")[0] ?? "(no stderr)"
      rejectReasons.set(msg, (rejectReasons.get(msg) ?? 0) + 1)
      for (const r of mine) r.protocName = "(protoc rejected this file)"
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }

  const agrees = rows.filter((r) => r.agree).length
  const disagree = rows.length - agrees
  const protocVerified = rows.filter((r) => r.protocExtendee !== null).length

  // The price: an id TWO files publish, where protoc says the two extensions are
  // DISTINCT symbols — so the collision is the analyzer's, not the corpus's.
  const idFiles = new Map<string, Set<string>>()
  for (const r of rows) {
    const arr = idFiles.get(r.analyzerId) ?? new Set<string>()
    arr.add(r.file)
    idFiles.set(r.analyzerId, arr)
  }
  const collisions: any[] = []
  for (const [id, fs_] of idFiles) {
    if (fs_.size < 2) continue
    const rs = rows.filter((r) => r.analyzerId === id)
    // protoc's own identity for each: own package + name. Distinct packages ⇒ protoc
    // sees distinct symbols and the id collision is the analyzer's.
    const protocIdentities = new Set(rs.filter((r) => r.protocExtendee !== null).map((r) => r.expectedOwnPackageId))
    collisions.push({
      id,
      files: [...fs_].map((f) => path.relative(CORPUS, f)).sort(),
      ownPackages: [...new Set(rs.map((r) => r.pkg))].sort(),
      extendees: [...new Set(rs.map((r) => r.extendee))].sort(),
      protocDistinctSymbolCount: protocIdentities.size,
      protocSeesDistinctSymbols: protocIdentities.size > 1,
      rows: rs.map((r) => ({ rel: r.rel, ownPackage: r.pkg, ownName: r.ownName, extendee: r.extendee, number: r.protocNumber })),
    })
  }
  collisions.sort((a, b) => Number(b.protocSeesDistinctSymbols) - Number(a.protocSeesDistinctSymbols))

  console.log(`\ncorpus: ${files.length} .proto files, ${symlinks.n} symlinked entries skipped`)
  console.log(`parsed ${parsed}  failed ${failed}`)
  console.log(`\nEXTENSION MEMBERS: ${rows.length} in ${new Set(rows.map((r) => r.file)).size} files`)
  console.log(`  analyzer id == <own package>.<name>   ${agrees}   AGREE`)
  console.log(`  analyzer id == <extendee>.<name>      ${disagree}   DISAGREE with protoc's identity`)
  console.log(`  protoc compiled the file  ${protocOk}   and its decoded output held ${protocBlocks} extension blocks`)
  console.log(`  of this lane's ${rows.length} extension members, protoc read ${protocVerified}`)
  console.log(`  protoc REJECTED the file  ${protocRejected}`)
  for (const [m, n] of [...rejectReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`    ${n}  ${m}`)
  console.log(`  extension members in a protoc-verified file with NO protoc counterpart  ${protocMissing}`)

  const mineCollide = collisions.filter((c) => c.protocSeesDistinctSymbols)
  console.log(`\nIDS PUBLISHED BY MORE THAN ONE FILE: ${collisions.length}`)
  console.log(`  of those, protoc says the extensions are DISTINCT symbols  ${mineCollide.length}   <- the analyzer's collision`)
  console.log(`  of those, protoc says ONE symbol                              ${collisions.length - mineCollide.length}   <- the corpus's`)
  for (const c of mineCollide) {
    console.log(`\n${c.id}`)
    console.log(`  extendee(s) ${c.extendees.join(", ")}   protoc distinct symbols ${c.protocDistinctSymbolCount}`)
    for (const r of c.rows) console.log(`  ${r.ownPackage === "" ? "(no package)" : r.ownPackage}.${r.ownName}  number=${r.number}   ${r.rel}`)
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      { files: files.length, parsed, failed, extensionMembers: rows.length, agrees, disagree, protocOk, protocRejected, protocBlocks, protocVerified, protocMissing, collisions },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}

await main()