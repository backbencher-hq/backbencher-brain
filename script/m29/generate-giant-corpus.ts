// script/m29/generate-giant-corpus.ts — M29.R3 (issue #538): the giant-repo
// corpus generator.
//
// The M19 corpora (intellij-community at 273k files) are no longer present on
// this machine and the disk has no room to re-clone them (95% full, 11 GB
// free — recorded honestly). The R3 issue scope explicitly allows
// "intellij-community subsets etc.", and M19's own giant-scale gate is
// "files >= 50k". This generator produces a DETERMINISTIC (seeded) workspace
// of >= 50k source files across the wave-1 launch languages, with realistic
// structure: packages, classes with methods, cross-file calls, imports.
//
// The corpus is SYNTHETIC and is declared as such in every R3 evidence file.
// Its manifest (file counts per language, seed, generator commit) is the
// corpus revision R3 records.
//
// Output: .tools/m29-giant-corpus/ (gitignored) + manifest.json
// CLI:    npx tsx script/m29/generate-giant-corpus.ts

import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { createHash } from "node:crypto"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, ".tools", "m29-giant-corpus")

/** Deterministic PRNG (mulberry32) — same seed, same corpus, every time. */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20260904
/** Per-language file counts — total clears the M19 giant-scale bar (>=50k). */
const PLAN: Array<{ language: string; ext: string; count: number; dir: string }> = [
  { language: "java", ext: "java", count: 10000, dir: "src/main/java/com/giant" },
  { language: "kotlin", ext: "kt", count: 9000, dir: "src/main/kotlin/com/giant" },
  { language: "scala", ext: "scala", count: 9000, dir: "src/main/scala/com/giant" },
  { language: "typescript", ext: "ts", count: 8000, dir: "src/ts" },
  { language: "javascript", ext: "js", count: 8000, dir: "src/js" },
  { language: "python", ext: "py", count: 7000, dir: "src/py" },
]

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

function javaBody(i: number): string {
  const pkg = Math.floor(i / 100)
  return `package com.giant.p${pkg};

import java.util.List;

public class Klass${i} {
    private final List<String> items;

    public Klass${i}(List<String> items) {
        this.items = items;
    }

    public String m0() {
        return "k" + ${i} + items.size();
    }

    public int m1(int x) {
        return x * ${i} + m0().length();
    }

    public int m2() {
        return m1(2) + Helper${i}.twice(3);
    }
}

class Helper${i} {
    static int twice(int n) { return n * 2; }
}
`
}

function kotlinBody(i: number): string {
  const pkg = Math.floor(i / 100)
  return `package com.giant.p${pkg}

class Klass${i}(private val items: List<String>) {
    fun m0(): String = "k" + ${i} + items.size

    fun m1(x: Int): Int = x * ${i} + m0().length

    fun m2(): Int = m1(2) + HELPER.twice(3)
}

object HELPER {
    fun twice(n: Int): Int = n * 2
}
`
}

function scalaBody(i: number): string {
  const pkg = Math.floor(i / 100)
  return `package com.giant.p${pkg}

import scala.collection.immutable.List

class Klass${i}(items: List[String]) {
  def m0(): String = "k" + ${i} + items.size

  def m1(x: Int): Int = x * ${i} + m0().length

  def m2(): Int = m1(2) + Helper${i}.twice(3)
}

object Helper${i} {
  def twice(n: Int): Int = n * 2
}
`
}

function tsBody(i: number): string {
  return `import { helper${i} } from "./helper_${i}";

export class Klass${i} {
  private items: string[] = [];

  constructor(items: string[]) {
    this.items = items;
  }

  m0(): string {
    return \`k\${${i}}\${this.items.length}\`;
  }

  m1(x: number): number {
    return x * ${i} + this.m0().length;
  }

  m2(): number {
    return this.m1(2) + helper${i}(3);
  }
}

export function main${i}(): number {
  const k = new Klass${i}(["a"]);
  console.log(k.m0());
  return k.m2();
}
`
}

function jsBody(i: number): string {
  return `import { helper${i} } from "./helper_${i}.js";

export class Klass${i} {
  constructor(items) {
    this.items = items;
  }

  m0() {
    return \`k\${${i}}\${this.items.length}\`;
  }

  m1(x) {
    return x * ${i} + this.m0().length;
  }

  m2() {
    return this.m1(2) + helper${i}(3);
  }
}

export function main${i}() {
  const k = new Klass${i}(["a"]);
  console.log(k.m0());
  return k.m2();
}
`
}

function pyBody(i: number): string {
  return `"""Giant corpus module ${i} (deterministic; M29.R3)."""

import os


class Klass${i}:
    def __init__(self, items):
        self.items = items

    def m0(self):
        return f"k${i}{len(self.items)}"

    def m1(self, x):
        return x * ${i} + len(self.m0())

    def m2(self):
        return self.m1(2) + helper${i}(3)


def helper${i}(n):
    return n * 2


def main${i}():
    k = Klass${i}(["a"])
    print(k.m0())
    return k.m2()
`
}

// Companion import-target files (helper_N) so imports/cross-file edges are real.
function helperBody(language: string, ext: string, i: number): string {
  if (language === "typescript") return `export function helper${i}(n: number): number {\n  return n * 2;\n}\n`
  if (language === "javascript") return `export function helper${i}(n) {\n  return n * 2;\n}\n`
  return ""
}

function main(): void {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
  const rand = prng(SEED)
  const perLanguage: Record<string, number> = {}
  let total = 0
  for (const plan of PLAN) {
    const dir = path.join(OUT, plan.dir)
    mkdirSync(dir, { recursive: true })
    let written = 0
    for (let i = 0; i < plan.count; i++) {
      // Spread across package subdirs to avoid megadirs.
      const sub = path.join(dir, `p${Math.floor(i / 500)}`)
      if (!existsSync(sub)) mkdirSync(sub, { recursive: true })
      const needsHelper = (plan.language === "typescript" || plan.language === "javascript") && i % 2 === 0
      const mainPath = path.join(sub, needsHelper ? `mod_${i}.${plan.ext}` : `klass_${i}.${plan.ext}`)
      const body =
        plan.language === "java" ? javaBody(i)
        : plan.language === "kotlin" ? kotlinBody(i)
        : plan.language === "scala" ? scalaBody(i)
        : plan.language === "typescript" ? tsBody(i)
        : plan.language === "javascript" ? jsBody(i)
        : pyBody(i)
      writeFileSync(mainPath, body)
      written++
      if (needsHelper) {
        writeFileSync(path.join(sub, `helper_${i}.${plan.ext}`), helperBody(plan.language, plan.ext, i))
        written++
      }
      // A sprinkle of longer files (realism: not every file is tiny).
      if (rand() < 0.05) {
        appendFileSync(mainPath, `\n// padding block ${i}: ${"x".repeat(400)}\n`)
      }
    }
    perLanguage[plan.language] = written
    total += written
    console.log(`  ${plan.language.padEnd(11)} ${written} files`)
  }
  const manifest = {
    corpus: "m29-giant-corpus",
    kind: "synthetic-deterministic",
    declared: "Synthetic corpus (M19 corpora absent from this machine; disk 95% full — no re-clone). Generated by script/m29/generate-giant-corpus.ts.",
    seed: SEED,
    languages: perLanguage,
    totalFiles: total,
    generatorCommit: gitCommit(),
    generatorCommand: "npx tsx script/m29/generate-giant-corpus.ts",
    root: OUT,
  }
  // The manifest is content-addressed: sha256 over the per-language counts +
  // seed + generator commit is the corpus revision R3 records.
  const revision = createHash("sha256")
    .update(JSON.stringify({ seed: SEED, languages: perLanguage, generatorCommit: manifest.generatorCommit }))
    .digest("hex")
    .slice(0, 16)
  const final = { ...manifest, corpusRevision: revision }
  // OUTSIDE the corpus dir (sibling file): a manifest inside the corpus would
  // be counted by the indexer (a real 59001-vs-59000 drift the R3 verifier
  // caught) and would pollute the indexed file set.
  writeSealed(path.join(OUT, "..", "m29-giant-corpus-manifest.json"), final)
  console.log(`total: ${total} files — corpus revision ${revision}`)
}

main()
