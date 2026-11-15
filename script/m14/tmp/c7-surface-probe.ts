// script/m14/tmp/c7-surface-probe.ts — probe for the C7 framework trigger surface
// across the OO family (CONV-RB-1 #749 partial, CONV-PY-1 #747 dead, CONV-CS-2 #751 reference).
//
// Question answered with measurements: for the SAME trigger shape, what does each
// analyzer publish as `detectedFrameworks` / `frameworkPatterns`, and does the
// published state obey the family contract (deduped, single spelling per framework,
// array always present)?
//
// Run: bun script/m14/tmp/c7-surface-probe.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
import { RealPythonAnalyzer } from "../../../src/ast/real-python-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")

async function mkParser(wasm: string) {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const p = new P()
  p.setLanguage(LANG)
  return p
}

function show(label: string, meta: any) {
  const fw = meta.framework
  const det: string[] = meta.detectedFrameworks ?? []
  const pat: any[] = meta.frameworkPatterns ?? []
  const names = new Set(pat.map((p) => p.framework))
  const dupes = det.length - new Set(det).size
  console.log(`\n=== ${label}`)
  console.log(`    framework:          ${JSON.stringify(fw)}`)
  console.log(`    detectedFrameworks: ${JSON.stringify(det)}`)
  console.log(`    frameworkPatterns:  ${JSON.stringify(pat.map((p) => `${p.framework}${JSON.stringify(p.patterns)}`))}`)
  console.log(`    hasFrameworkIntelligence: ${meta.hasFrameworkIntelligence}`)
  console.log(`    -> dupes=${dupes}  distinct-pattern-names=${JSON.stringify([...names])}`)
}

const RUBY: Record<string, string> = {
  "one Rails model": `class User < ApplicationRecord\nend\n`,
  "five Rails models": `class A < ApplicationRecord\nend\nclass B < ApplicationRecord\nend\nclass C < ActiveRecord::Base\nend\nclass D < ApplicationRecord\nend\nclass E < ApplicationRecord\nend\n`,
  "one Rails controller": `class UsersController < ApplicationController\n  def index\n    render :json => {}\n  end\nend\n`,
  "five render calls": `class UsersController < ApplicationController\n  def a\n    render :json => {}\n  end\n  def b\n    render :json => {}\n  end\n  def c\n    render :json => {}\n  end\n  def d\n    render :json => {}\n  end\n  def e\n    render :json => {}\n  end\nend\n`,
  "before_action only": `class UsersController < ApplicationController\n  before_action :authenticate\nend\n`,
  "non-Rails superclass": `class Plain < Base\nend\n`,
  "plain ruby, no framework": `class Plain\n  def go\n    1\n  end\nend\n`,
}

const PY: Record<string, string> = {
  "django import": `import django\nfrom django.db import models\n`,
  "django model": `from django.db import models\n\nclass User(models.Model):\n    pass\n`,
  "flask app": `from flask import Flask\napp = Flask(__name__)\n`,
  "pytest usage": `import pytest\n\ndef test_x():\n    assert True\n`,
  "fastapi": `from fastapi import FastAPI\napp = FastAPI()\n`,
  "plain python": `x = 1\n`,
}

async function main() {
  const rb = await mkParser("tree-sitter-ruby.wasm")
  for (const [name, src] of Object.entries(RUBY)) {
    const root = rb.parse(src).rootNode
    const r: any = await (new RealRubyAnalyzer() as any).analyze(root, src, "probe.rb")
    show(`ruby / ${name}`, r.metadata ?? {})
  }

  const py = await mkParser("tree-sitter-python.wasm")
  for (const [name, src] of Object.entries(PY)) {
    const root = py.parse(src).rootNode
    const r: any = await (new RealPythonAnalyzer() as any).analyze(root, src, "probe.py")
    show(`python / ${name}`, r.metadata ?? {})
  }
}

main()
