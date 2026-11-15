import assert from "node:assert/strict"
import { ASTEngine } from "../../src/ast/engine"
import { compareEdgeIdentities, deriveRustBareUses, deriveRustDeclaredTypeRefs, deriveRustEdges } from "../../script/m14/differential"
import { deriveRubyEdges } from "../../script/m14/ruby-truth"
import { deriveRustContainsTruth } from "../../script/m14/oracles/rust-contains"
import { deriveRustImportsTruth, deriveRustOverridesTruth } from "../../script/m14/rust-truth"

const rust = `
use std::io;
use {std::path::Path as FilePath, std::fs::File};
struct Packet;
impl Packet {
    fn decode(&self) -> Packet { Packet }
    fn read(&self) -> Packet { self.decode() }
    fn again(&self) -> Packet { Self::decode(self) }
}
fn direct(packet: Packet) -> Packet { Packet::decode(&packet) }
fn construct() -> Record { assert!(true); Record { value: 1 } }
struct Record { value: usize }
trait Describe { type Item; fn describe(&self); }
impl<'a, T> Describe for &'a mut T {
    type Item = T;
    fn describe(&self) {}
}
impl Describe for io::Error { type Item = io::Error; fn describe(&self) {} }
impl Describe for str { type Item = usize; fn describe(&self) {} }
impl Describe for [u8] { type Item = usize; fn describe(&self) {} }
`
const rustTree = (await ASTEngine.parseTree("endpoints.rs", rust)).tree
try {
  assert.equal(rustTree.rootNode.hasError, false)
  const refs = deriveRustDeclaredTypeRefs(rustTree.rootNode, true).filter(edge => edge.target === "Packet")
  assert.deepEqual(refs.map(edge => edge.from).sort(), ["again", "decode", "direct", "read"])
  const calls = deriveRustEdges(rustTree.rootNode, true).filter(edge => edge.label === "calls")
  assert.deepEqual(calls.filter(edge => edge.target === "Packet::decode").map(edge => edge.from).sort(), ["again", "direct", "read"])
  const result = await ASTEngine.parseFile("endpoints.rs", rust)
  const actual = result.relationships.map(edge => ({ label: edge.type, from: edge.source, target: edge.target }))
  const contains = deriveRustContainsTruth(rustTree.rootNode)
  for (const [from, target] of [["Describe", "Item"], ["T", "Item"], ["T", "describe"],
    ["str", "Item"], ["anonymous_impl", "describe"]]) {
    assert.ok(contains.some(edge => edge.from === from && edge.target === target))
    assert.ok(actual.some(edge => edge.label === "contains" && edge.from === from && edge.target === target))
  }
  const use = deriveRustBareUses(rustTree.rootNode).find(edge => edge.from === "io::Error::r#impl" && edge.target === "io")
  assert.ok(use)
  assert.equal(compareEdgeIdentities([use], actual).matched, 1)
  const construct = deriveRustEdges(rustTree.rootNode, true).find(edge => edge.label === "instantiates" && edge.from === "construct" && edge.target === "Record")
  assert.ok(construct)
  assert.equal(compareEdgeIdentities([construct], actual).matched, 1)
  assert.ok(deriveRustImportsTruth(rustTree.rootNode).some(edge => edge.target === "std::path"))
  assert.ok(!deriveRustOverridesTruth(rustTree.rootNode).some(edge => edge.from === "u8.describe"))
  assert.equal(compareEdgeIdentities([...refs, ...calls], actual).missing.length, 0)
  assert.equal(compareEdgeIdentities(calls, actual.filter(edge => edge.from !== "direct")).missing.length, 1)
} finally {
  rustTree.delete()
}

const ruby = `
require File.expand_path("helper", __dir__)
class Worker
  def self.run; end
  def run; end
  private_class_method :run
  def self.reveal; end
  private_class_method :reveal
  self.public_class_method :reveal
  def probe
    block_given?
    Thread.current[:cached] ||= []
    klass = Class.new
    value = klass.new
    stat = stat(value)
    @env[:key] = value
    def @object.visit; end
  end
  alias :run_again :run
  alias kind_of? is_a?
  class << self
    alias [] new
  end
end
Other.private_class_method :name
class Base
  def process; end
end
class Child < Remote::Base
  def process; end
end
module Project
  class LocalBase
    def process; end
  end
end
class Verified < Project::LocalBase
  def process; end
end
class Dynamic < Struct.new(:item); end
`
const rubyTree = (await ASTEngine.parseTree("endpoints.rb", ruby)).tree
try {
  assert.equal(rubyTree.rootNode.hasError, false)
  const truth = deriveRubyEdges(rubyTree.rootNode)
  const result = await ASTEngine.parseFile("endpoints.rb", ruby)
  const staticMethod = (name: string) => result.symbols.find(symbol => symbol.name === name && symbol.isStatic)
  assert.equal(staticMethod("run")?.visibility, "private")
  assert.equal(result.symbols.find(symbol => symbol.name === "run" && !symbol.isStatic)?.visibility, "public")
  assert.equal(staticMethod("reveal")?.visibility, "public")
  for (const [from, target] of [
    ["Global", "expand_path"], ["probe", "block_given?"], ["Global", "private_class_method"],
    ["probe", "current"], ["probe", "new"], ["probe", "stat"],
    ["Worker", "run_again"], ["Worker", "kind_of?"], ["Worker", "[]"],
  ]) {
    assert.ok(truth.some(edge => edge.label === "calls" && edge.from === from && edge.target === target))
    assert.ok(result.relationships.some(edge => edge.type === "calls" && edge.source === from && edge.target === target))
  }
  assert.ok(!result.relationships.some(edge => edge.type === "calls" && edge.source === "Worker" && edge.target.endsWith("_class_method")))
  assert.ok(!result.relationships.some(edge => edge.source === "Worker" && edge.target === "new"))
  assert.ok(truth.some(edge => edge.label === "uses" && edge.from === "probe" && edge.target === "@env"))
  assert.ok(truth.some(edge => edge.label === "uses" && edge.from === "probe" && edge.target === "@object"))
  assert.ok(result.relationships.some(edge => edge.type === "uses" && edge.source === "probe" && edge.target === "@object"))
  const override = result.relationships.find(edge => edge.type === "overrides" && edge.source === "Child.process")
  assert.equal(override?.target, "Remote::Base.process")
  assert.equal(override?.metadata?.evidenceClass, "inferred")
  const verified = result.relationships.find(edge => edge.type === "overrides" && edge.source === "Verified.process")
  assert.equal(verified?.target, "LocalBase.process")
  assert.equal(verified?.metadata?.evidenceClass, "structural")
  assert.ok(truth.some(edge => edge.label === "overrides" && edge.from === "Verified.process" &&
    edge.target === "LocalBase.process" && !edge.targetUnverified))
  assert.ok(!truth.some(edge => edge.label === "extends" && edge.from === "Dynamic"))
  const external = { label: "overrides", from: "Child.process", target: "Remote::Base.process" }
  const guessed = { ...external, targetUnverified: true }
  const guesses = compareEdgeIdentities([guessed], [guessed])
  assert.equal(guesses.matched, 0)
  assert.equal(guesses.unverifiedTargets.length, 1)
  assert.equal(guesses.unverifiedActual.length, 1)
  assert.equal(compareEdgeIdentities([external], [guessed]).missing.length, 1)
  assert.equal(compareEdgeIdentities([external], [external, guessed]).matched, 1)
} finally {
  rubyTree.delete()
}
console.log("Rust and Ruby endpoint reconciliation verified")
process.exit(0)
