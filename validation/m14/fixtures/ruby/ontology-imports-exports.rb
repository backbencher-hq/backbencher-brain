# Ontology: the two relationship types this lane did not emit (`imports`,
# `exports`), pinned on the shapes that decide them.
#
# Authored BEFORE the implementation run, against the two rulings the change was
# made under — not against the analyzer's output:
#
#   * `imports` — Ruby's import IS `require`. The construct was measured at 11,928
#     receiverless literal-path requires + 205 autoloads over the corpus, so the
#     type is a GAP, not a ruling. It rides the SAME sites as `references`, so
#     every negative that `references` already had must hold for it too; that is
#     why the forbids below repeat the interpolation and receiver cases.
#
#   * `exports` — Ruby states no export keyword, so the surface is a convention
#     and the ruling that shapes it is the repository's, not this lane's: the M49
#     exports-family invariant in run-fixtures.ts (an export is an IMPORTABLE
#     UNIT; type-owned members are refused with "membership rides Contains"; names
#     are unique). So the surface is the file's TOP-LEVEL declarations and nothing
#     else. Every negative below is a shape the invariant excludes.
#
# The pins that can FAIL are collected here rather than one at a time:
#   * `require` / `require_relative` / `load` / `autoload` each produce BOTH an
#     `imports` and a `references` edge — dropping either half fails.
#   * `resolution` is `file-relative` for `require_relative` (a path relative to
#     the requiring file, by definition) and `load-path` for the rest ($LOAD_PATH,
#     which can name a gem OR a project file, so its location is unknown). A fix
#     that hardcoded one value for all four fails both ways.
#   * `fileLevel: true` is what binds the IMPORTER to the file
#     (`parallel-indexer.ts` reads it); without it the edge's source stays a scope
#     sentinel and no surface can answer "what does this file require".
#   * `exports` source is the file's unit — this fixture's basename — because the
#     unit of a top-level declaration is the file and nothing else names it.
#   * `private_constant` is load-bearing through the FACTORY form: `Hidden =
#     Struct.new(:a)` is a top-level type with no owner, so it IS an importable
#     unit, and `private_constant :Hidden` is the only thing that removes it. A
#     plain top-level `CONST = 1` would pin nothing, because this analyzer
#     declares no symbol for it at all (see the lane doc's limitations) and so it
#     has no name to export either way.

# --- imports: four require forms, one shared site ----------------------------
require "json"
require_relative "sibling/helper"
load "template.erb"
autoload :LazyParser, "lazy/parser"

# The negatives for the require family, on the SAME lines' constructs:
require "a/#{dynamic}"          # a template, not a path
def strong_params(x)
  x.require("body-mime")        # a receiver: some object's method
end

# --- exports: the file's top-level importable units --------------------------
class TopLevel
  def member_method; end         # a MEMBER: contains, never an importable unit
  class Nested; end              # a member of a member
  CONSTANT_INSIDE = 1
end

module TopLevelModule
  def module_member; end
end

def top_level_helper; end        # a method on Object: callable by name anywhere

def self.main_singleton; end     # a singleton of `main`: unreachable elsewhere

Factory = Struct.new(:a)         # a top-level type with NO owner: an importable unit

Hidden = Struct.new(:b)
private_constant :Hidden          # ... which this removes from the surface

class TopLevel                    # a REOPEN of the class above: ONE importable
  def second_reopen_method; end    # unit, so the export list names it exactly once
end