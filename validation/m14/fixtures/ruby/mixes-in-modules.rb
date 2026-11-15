# RUBY-D1 (ALL-OUT-OF-ALL phase 2): `include` / `prepend` / `extend` are MODULE MIXIN
# COMPOSITION — canonical `mixes_in`, never `implements` and never `extends`.
#
# Ruby's grammar has no interface/conformance construct: `include M` inserts M into the class's
# ancestor chain, `prepend M` inserts it before the class, `extend M` inserts it into the singleton
# class. The canonical vocabulary has exactly one value for that construct, `mixes_in` (source = the
# composing class/module, target = the mixin) — the same value Dart's `with` carries. The family's
# previous adaptation (include/prepend -> implements, extend -> extends) is what this fixture
# replaces; `implements` is ruled NOT APPLICABLE for Ruby and must publish NOTHING.
#
# The three positives pin the three spellings; the `metadata.mixinType` rows pin WHICH keyword
# produced the edge (a consumer must be able to tell prepend from include, and extend from `<`).
# The dynamic control pins the existing refusal: a mixin argument that is a VARIABLE is unknowable
# statically, so it emits nothing (the analyzer's constant-only rule; rake file_list.rb's
# `patterns.each { |pattern| include(pattern) }` fabricated `implements:pattern` before it).
# `class Child < Base` stays `extends` — the superclass control proves the relabel did not eat
# inheritance.

module ComparableLike
  def <=>(other)
    name <=> other.name
  end
end

module PrependedHelpers
  def help
    :helped
  end
end

module SingletonHelpers
  def singleton_help
    :singleton_helped
  end
end

class BaseThing
  def base_method
    :base
  end
end

class MixedThing < BaseThing
  include ComparableLike
  prepend PrependedHelpers
  extend SingletonHelpers

  attr_reader :name

  def initialize(name)
    @name = name
  end
end

# The dynamic control: a lower-case argument is a local/variable, not a statically nameable module.
class DynamicMixin
  def apply(mixin_module)
    include(mixin_module)
  end
end
