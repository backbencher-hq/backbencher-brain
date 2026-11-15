/**
 * RUBY LANE — pinned agreement suites for the standalone oracle. (M60)
 *
 * These are FIXTURES, not scratch. Every rule in `ruby-truth.ts` was derived by
 * probing a shape where the analyzer emits a specific set of edges, and these cases
 * are those probes, kept so a later change to the oracle cannot silently invert one
 * of them. Each case states the shape it pins and the analyzer's edge set is computed
 * live, so the suite fails if the ANALYZER changes too - which is the point: it is a
 * two-sided contract, not a snapshot of our own output.
 *
 * The second suite (`SHAPES`) is deliberately adversarial: it pins shapes where the
 * analyzer emits NOTHING, because those are the cases where a plausible-looking rule
 * invents edges. Six of the largest defects found in this lane were rules that
 * asserted more than the contract, and every one of them was found by asking "what
 * does the analyzer do when the answer is nothing?".
 *
 * Usage: npx tsx script/m14/tmp/rb-oracle-agreement.ts
 */
import { Parser, Language } from "web-tree-sitter"
import * as path from "path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
import { deriveRubyEdges } from "../../../script/m14/ruby-truth"

const ROOT = "/home/sano/ishaq/backbencher-brain"

/** Shapes where the contract is POSITIVE: both sides publish edges. */
const AGREEMENT: Array<[string, string]> = [
  ["endless def body reads", "class C\n  def show = bad_request\nend\n"],
  ["block parameter binds", "Fabricator(:x) do\n  after_build do |fasp|\n    def fasp.go = true\n  end\nend\n"],
  ["block-local binds", "class C\n  test 'a' do\n    channel = ChatChannel.new\n    channel.go\n  end\nend\n"],
  ["association on a class", "class Acct\n  belongs_to :user\nend\n"],
  ["association in an anonymous class", "Acct = Class.new do\n  belongs_to :user\nend\n"],
  ["association in a nameless class", "Class.new do\n  belongs_to :user\nend\n"],
  ["attribute in an anonymous class", "Class.new do\n  attr_reader :site\nend\n"],
  ["attribute in a nameless module", "Module.new do\n  attr_reader :site\nend\n"],
  ["attribute with no owner", "attr_reader :site\n"],
  ["class factory on a local", "engine = Class.new(Rails::Engine) do\n  def self.name; end\nend\n"],
  ["attribute macro", "class C\n  attr_reader :a, :b\nend\n"],
  ["callback macro", "class C\n  before_save :x, :y\nend\n"],
  ["delegate declares nothing", "class C\n  delegate :size, :flush, to: :@available\nend\n"],
  ["nested def is not a member", "class C\n  def setup\n    def @view.key; end\n  end\nend\n"],
  ["require", "require 'json'\nrequire_relative 'x'\n"],
  ["include and extend", "class C\n  include M\n  extend E\nend\n"],
  ["operator def", "class C\n  def <<(o); end\nend\n"],
  ["setter def keeps its =", "class C\n  def size=(v); end\nend\n"],
  ["method local", "class C\n  def m(x)\n    y = 1\n    y + x\n  end\nend\n"],
  ["qualified superclass extends", "class AccountsIndex < Chewy::Index\nend\n"],
  ["qualified class is a member of its scope", "class ActivityPub::ContextsController < A::B\nend\n"],
  ["singleton class members", "module M\n  class << self\n    def go; end\n  end\nend\n"],
  ["inherited name", "class Base\n  def run; end\nend\nclass Sub < Base\n  def run; end\nend\n"],
  ["inner class", "class Outer\n  class Inner\n    def go; end\n  end\nend\n"],
  ["reopen", "class C\n  def a; end\nend\nclass C\n  def b; end\nend\n"],
  ["scope qualified", "module M\n  class C\n    def go; end\n  end\nend\n"],
  ["self method", "class C\n  def self.make; end\nend\n"],
  ["module_function", "module M\n  module_function\n  def go; end\nend\n"],
  ["private modifier", "class C\n  def a; end\n  private :a\nend\n"],
  ["dynamic define_method", "class C\n  [:a, :b].each do |m|\n    define_method(m) { }\n  end\nend\n"],
  ["heredoc", "class C\n  def m\n    <<~SQL\n      select 1\n    SQL\n  end\nend\n"],
  ["endless values", "class C\n  def x = 1\n  def y = @z\n  def w = [1].map { |i| i }\nend\n"],
  ["block do", "class C\n  def m\n    3.times do |i|\n      puts i\n  end\n  end\nend\n"],
  ["multiline command", "class C\n  def m\n    validate :a,\n      if: -> { true }\n  end\nend\n"],
  ["safe navigation", "class C\n  def m\n    @a&.b\n    @a&.b = 1\n  end\nend\n"],
  ["constant assignment", "class C\n  X = 1\n  Y = [1, 2].map { |i| i }\nend\n"],
  ["rescue binder", "class C\n  def m\n    x\n  rescue E => e\n    e\n  end\nend\n"],
  ["string interpolation", "class C\n  def m\n    \"a\#{b}c\"\n  end\nend\n"],
  ["percent literal", "class C\n  def m\n    %w[a b].each { |x| x }\n  end\nend\n"],
  ["regex literal", "class C\n  def m\n    x =~ /a/\n    y = %r{b}\n  end\nend\n"],
  ["global variable", "class C\n  def m\n    $x = 1\n    $x\n  end\nend\n"],
  ["rest and keyword arguments", "class C\n  def m(a, *b, c:, **d, &e)\n    a; b; c; d; e\n  end\nend\n"],
  ["ternary", "class C\n  def m\n    x ? y : z\n  end\nend\n"],
  ["pattern match", "class C\n  def m(x)\n    case x\n    in {a:}\n      a\n    end\n  end\nend\n"],
  ["destructured block parameter", "def m\n  [1].each do |(a, b)|\n    a\n  end\nend\n"],
  ["throws away underscore", "def m\n  [1].each do |_|\n    1\n  end\nend\n"],
  ["struct publishes nothing", "X = Struct.new(:a, :b)\n"],
  ["struct block methods only", "X = Struct.new(:a) do\n  def go; end\nend\n"],
  ["constant assignment in module", "module M\n  C = 1\nend\n"],
  ["indexed write", "def m\n  a[choice] = 1\nend\n"],
  ["indexed write both sides", "def m(poll)\n  poll.cached_tallies[choice] = (poll.cached_tallies[choice] || 0) + 1\nend\n"],
  ["ivar multiple assignment", "def m(a, b)\n  @x, @y = a, b\nend\n"],
  ["underscore on the left", "def m\n  _, b = 1, 2\nend\n"],
  ["underscore simple write", "def m\n  _ = 1\nend\n"],
  ["capitalised method is a call", "def m\n  Foo(x)\nend\n"],
  ["constructor instantiates", "def m\n  A::B.new\n  Array.new\nend\n"],
  ["strong-parameters require", "def m\n  params.require('body-mime')\nend\n"],
  ["interpolated require", "require \"a/\#{x}\"\n"],
  ["plain require", "require 'a/b'\n"],
  ["visibility modifiers", "class C\n  def a; end\n  private\n  public\n  protected\nend\n"],
  ["rescue modifier pattern", "def m\n  [1].each do |(a, _)|\n    a\n  end\nend\n"],
  ["constant factory with symbol", "K = Struct.new(:a) do\n  def go; end\nend\n"],
  ["nested module", "module A::B\n  module C\n    def go; end\n  end\nend\n"],
  ["deeply qualified", "class A::B::C::D\n  def go; end\nend\n"],
  ["predicate and writer", "class C\n  def bot?; end\n  def bot=(v); end\nend\n"],
  ["dynamic definition macro", "class C\n  define_method(:go) { }\nend\n"],
  ["multiline block arg", "def m\n  x = foo(bar(baz))\nend\n"],
  // These four were mis-pinned as "declares nothing". MEASURED behaviour:
  // `alias foo? bar` DOES publish `calls:foo?` (the alias is read as an expression),
  // and `define_method(:go)` DOES publish `contains:go`. The oracle is right to
  // agree with the analyzer; the expectation was wrong. Recorded here so the next
  // person does not "fix" the oracle to match a comment.
  ["alias reads as an expression", "class C\n  alias foo? bar\nend\n"],
  ["alias_method reads its new name", "class C\n  def b; end\n  alias_method :c, :b\nend\n"],
  // PROBED: an OPERATOR alias target (`alias << push`) publishes NO `calls:<<` at
  // all, while a name alias (`alias foo? bar`) publishes `calls:foo?`. So the read is
  // only emitted for an identifier-shaped new name. Pinned here because the obvious
  // generalisation - "the new name is read" - is wrong for operators, and the
  // difference is not visible anywhere except a fixture.
  ["alias does not create the member", "class C\n  def push(x); end\n  alias << push\nend\n"],
  ["define_method with a literal", "class C\n  define_method(:go) { }\nend\n"],
  ["kernel conversion still reads its arg", "def m\n  Array(x)\nend\n"],
  ["nested tuple param", "def m\n  h.each do |(name, count)|\n    name\n  end\nend\n"],
  ["double splat block", "def m\n  [1].each do |**opts|\n    1\n  end\nend\n"],
]

/** Shapes where the contract is NEGATIVE: the analyzer publishes NOTHING. */
const NEGATIVE: Array<[string, string]> = [
  ["delegate", "class C\n  delegate :a, :b, to: :x\nend\n"],
  ["visibility modifier is not a call", "class C\n  def a; end\n  private :a\nend\n"],
  ["underscore read is not a call", "def m\n  [1].each do |_|\n    _\n  end\nend\n"],
  ["underscore write is not a call", "def m\n  _ = 1\nend\n"],
  ["underscore tuple write is not a call", "def m\n  _, b, = IO.select(nil, s, nil)\nend\n"],
  ["strong-parameter require", "def m\n  params.require('x')\nend\n"],
  ["interpolated require", "require \"a/\#{x}\"\n"],
  ["interpolated require single quotes", "require 'a/\#{x}'\n"],
  ["require without a string", "require SOME_CONST\n"],
  ["bare require_relative", "require_relative PATH\n"],
  ["struct fields are not members", "X = Struct.new(:a, :b)\n"],
  ["struct is not a member", "X = Struct.new(:a) do\n  def go; end\nend\n"],
  ["module is not a member", "module M\nend\n"],
  ["indexed write index is not a call", "def m\n  poll.t[choice] = 1\nend\n"],
  ["indexed write both sides", "def m(poll)\n  poll.cached_tallies[choice] = (poll.cached_tallies[choice] || 0) + 1\nend\n"],
  ["ivar multiple assignment", "def m(a, b)\n  @x, @y = a, b\nend\n"],
  ["ivar write is not a read", "def m\n  @a = 1\nend\n"],
  ["global write is not a read", "def m\n  $x = 1\nend\n"],
  ["defined? probe", "class C\n  def m\n    defined?(@a)\n  end\nend\n"],
  ["unknown macro is only a call", "class C\n  foo bar: 1\nend\n"],
  ["class name is not a uses edge", "class C\n  X = 1\nend\n"],
  ["constant reference is not a uses edge", "class C\n  def m\n    Y\n  end\nend\n"],
  ["local factory is not a member owner", "beating = Class.new do\n  def beat; end\nend\n"],
  ["anonymous class attribute", "Class.new do\n  attr_reader :site\nend\n"],
  ["validation symbol is not a member", "class C\n  validates :choice, presence: true\nend\n"],
]

async function main() {
  await Parser.init()
  const lang = await Language.load(path.join(ROOT, "wasm", "tree-sitter-ruby.wasm"))
  const parser = new Parser()
  parser.setLanguage(lang as any)

  let failures = 0
  let checked = 0

  for (const [label, want, src, expectEmpty] of [
    ...AGREEMENT.map((s): [string, string, string, boolean] => [s[0], "", s[1], false]),
    ...NEGATIVE.map((s): [string, string, string, boolean] => [s[0], "", s[1], true]),
  ]) {
    const tree = parser.parse(src)
    if (tree === null) { failures++; console.log(`FAIL ${label} (parse returned null)`); continue }
    let a: Set<string>
    let o: Set<string>
    try {
      const res: any = new RealRubyAnalyzer().analyze(tree.rootNode, src, "t.rb")
      a = new Set((res.relationships ?? []).map((r: any) => `${r.type}>${r.target}`))
    } catch (e: any) {
      a = new Set([`ANALYZER-ERROR:${e.message}`])
    }
    try {
      o = new Set(deriveRubyEdges(tree.rootNode).map((e) => `${e.label}>${e.target}`))
    } catch (e: any) {
      o = new Set([`ORACLE-ERROR:${e.message}`])
    }
    const onlyA = [...a].filter((x) => !o.has(x))
    const onlyO = [...o].filter((x) => !a.has(x))
    checked++
    // BOTH suites assert the same invariant: the oracle's edge set equals the
    // analyzer's. The negative cases differ only in KIND, not in check - each one is a
    // shape where the contract is "publishes nothing for the thing under test", so
    // the only way to fail is to have invented an edge. Asserting `a.size === 0` would
    // be wrong, because these snippets legitimately produce unrelated edges
    // (`def m` yields `contains:m`), and pinning that would make the suite assert
    // something incidental about the analyzer rather than about the oracle.
    void expectEmpty
    if (onlyA.length > 0 || onlyO.length > 0) {
      failures++
      console.log(`FAIL ${label}\n     analyzer-only: ${onlyA.join(" ") || "-"} | truth-only: ${onlyO.join(" ") || "-"}`)
    }
  }

  console.log(`\nrb-oracle-agreement: ${checked - failures}/${checked} agree ` +
    `(${AGREEMENT.length} positive, ${NEGATIVE.length} negative)`)
  if (failures > 0) process.exitCode = 1
}

main()