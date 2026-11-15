# Ontology round 2 — the two edges inside an already-emitted type that were
# owed or wrong, pinned on the shapes that decide them.
#
# Authored from the RULINGS, before reading analyzer output for these shapes.
# Every pin here corresponds to a number:
#
#   * `K = Class.new(Base)` declares a superclass. 16 sites over 7,499 files
#     (rb-factory-define-probe.ts). `Struct.new(:a, :b)` and `Data.define(:a, :b)`
#     take MEMBER NAMES as their first argument and have no superclass parameter:
#     116 sites. So the rule is `Class.new` ONLY, and the ratio — 116 to 16 — is
#     why. A general factory rule fabricates seven edges per edge it gets right,
#     and every fabricated `extends` poisons bb_graph, bb_impact and bb_migrate.
#   * `define_method` takes the NAME in argument 0 and the BODY in argument 1.
#     `define_method(name, "")` therefore names nothing statically: 2 empty-named
#     symbols and 2 empty-target `contains` edges over the corpus before the fix.
#   * A published name resolves the Ruby escapes it can state and is REFUSED when
#     it carries one it cannot: `\"` and `\\` are text; `\x` is a raw byte and `\u`
#     a non-ASCII character, and neither is a name a consumer can bind.
#
# The pins that can FAIL:
#   * dropping the factory `extends` fails outright;
#   * generalising it to `Struct.new`/`Data.define` fails both forbids below;
#   * accepting argument 1 of `define_method` as a name fails the two empty-name
#     forbids AND the wrong-name forbid;
#   * publishing an unresolved `\"` fails the resolved-quote pin;
#   * publishing a `\x`-carrying name fails its forbid — and silence passes it,
#     which is the point: a name the analyzer cannot state is not published.

# --- extends: a factory base is a superclass --------------------------------
Job = Class.new(BaseRunner)
Scoped = Class.new(::BaseRunner)
Namespaced = Class.new(BenchmarkDriver::DefaultJob)

# The counter-shapes. `Struct.new` and `Data.define` take MEMBER NAMES, so these
# are classes with members, not classes with a superclass.
Car = Struct.new(:wheels, :doors)
Point = Data.define(:x, :y)

# A base that is a CALL is unknowable statically and is refused, for the same
# reason `class X < Struct.new(:a)` is refused.
Dynamic = Class.new(base_for(some_arg))
Anon = Class.new do
  def helper; end
end

# The written form still works, and it is the same relationship:
class Written < BaseRunner
end

# --- define_method: the NAME is argument 0 ----------------------------------
class Naming
  define_method(:literal_name) { 1 }
  define_method("string_name") { 2 }
  define_method(:"oper_name") { 3 }

  # Argument 0 is a VARIABLE, so the name is only known at runtime and argument 1
  # is the BODY. Both of these must publish nothing at all — not a Method named
  # "", not one named after the body.
  def self.runtime_named(name)
    define_method(name, "")
    define_method(name, "an implementation body")
  end
end

# --- escapes: resolved where the analyzer can state them, refused where not ---
class Escaped
  # Ruby defines a method whose name contains a plain quote.
  define_method("say \"hi\"") { 4 }

  # `\\` is an escaped BACKSLASH and `x61` after it is literal text, so the name
  # Ruby really defines contains `\x61`. Publishing it resolved is correct.
  define_method("hex \\x61 text") { 5 }

  # `\x41` is the BYTE 0x41. The analyzer declines to state this name, so nothing
  # is published — a name it cannot write is not a name.
  define_method("byte \x41 here") { 6 }
end