# ruby/mixin-discriminator.rb — THE DISCRIMINATOR FIXTURE for ruby's `mixes_in`.
#
# WHY THIS FILE EXISTS. Dart's `renders` lane shipped a filter that DISCRIMINATES: the construct is
# Flutter's `build` method, and the trigger is a `build` method whose DECLARED RETURN TYPE IS
# `Widget` — which is what keeps the protobuf-style message builders out. **A FILTER ON THE NAME
# DOES NOT SEPARATE THE CONSTRUCT FROM ITS IMPOSTORS.** Ruby's `mixes_in` was exactly such a filter
# (the name is `include`/`extend`/`prepend`), and this round's census measured **127 impostor rows in
# 543 published rows (23.4 %)** over the whole admitted population.
#
# ⇒ THE DISCRIMINATOR HERE IS THE STATIC SELF-TYPE AT THE CALL SITE — ruby's analogue of dart's
# declared return type — plus the rule that an explicit receiver names a DIFFERENT composer:
#
#   · a class / module body                     → composes into the class
#   · a `Class.new { }` / `Module.new { }` block → composes into the new class (the block is
#     class_eval'd, so `self` inside it is the new class whatever encloses it lexically)
#   · a `def self.x` (a singleton method)       → `self` IS the class ⇒ composes into the class
#   · a plain `def x`                           → `self` IS an INSTANCE ⇒ does NOT compose
#   · the file's top level                      → `self` IS `main` ⇒ does NOT compose
#   · an explicit receiver other than `self`    → composes into the RECEIVER, not the class
#
# ⇒ EVERY IMPOSTOR CLASS BELOW IS PINNED, AND SO IS EVERY LEGITIMATE SHAPE — so a fix that refuses
# too much fails here as loudly as one that refuses too little. THE POSITIVES ARE THE CONTROL: they
# are what makes the forbids mean something.

module Composed
  class Real
    include BodyModule
    extend SingletonModule
    prepend PrependedModule

    # A SINGLETON METHOD — `self` is the class here, so this DOES compose into the class. A naive
    # "is there a `def` above me" rule would refuse it, and this row is what catches that mistake.
    def self.class_level
      include ClassMethodModule
    end

    # A PLAIN INSTANCE METHOD — `self` is an INSTANCE here, so `include`/`extend` do NOT compose
    # into the class: `extend` extends the instance's singleton class, and `include` is not
    # Module#include at all.
    def instance_level
      include InstanceBodyModule
      extend InstanceSingletonModule
    end
  end
end

# THE FACTORY SHAPE — a `Class.new { }` block is class_eval'd, so `self` inside it is the NEW class.
Factory = Class.new do
  include FactoryModule
end

# THE OWNERLESS FACTORY — THE FOURTH IMPOSTOR CLASS, AND THE ONE THE THREE-WAY SCOPE AGREEMENT
# FOUND. A `Class.new { }` block whose LEFT HAND SIDE IS A LOCAL declares no class: the class it
# builds is ANONYMOUS, so the mixin composes into a class that has NO NAME. **⇒ A ROW FOR IT
# WOULD HAVE TO BE ATTRIBUTED TO A NAME THAT DOES NOT EXIST** — and the pre-fix analyzer fell back
# to the file-scope sentinel `Global`, which is not what happens.
#
# ⇒ MEASURED over the whole admitted population: 20 published `mixes_in` rows were exactly this
# (e.g. `rack/test/spec_utils.rb:33`, `instance = Class.new { include Rack::Utils … }.new`; and
# `gql-ruby/spec/graphql/schema/interface_spec.rb:58`). The ORACLE refused them on its own
# namable-owner rule; the analyzer published them. ⇒ The two readings are INDEPENDENT, so their
# disagreement was a finding rather than a tautology.
#
# ⇒ AND NOTE THE CONTRAST WITH THE POSITIVE ABOVE: `Factory = Class.new do` NAMES its class (the
# constant `Factory`), so its row is published with `from: Factory`; `anonymous = Class.new do`
# names NOTHING, so there is no row at all. **⇒ THE DIFFERENCE IS THE NAMEABILITY OF THE OWNER,
# NOT THE SHAPE OF THE BLOCK.**
anonymous = Class.new do
  include AnonymousModule
end

# (A) AN EXPLICIT RECEIVER — the mixin composes into the RECEIVER, not into the enclosing class,
# and a local variable receiver names no class at all, so the row is unattributable.
class ReceiverHost
  def compose(target)
    target.extend ReceiverModule
    target.include ReceiverIncludedModule
  end
end

# (T) THE FILE'S TOP LEVEL — `self` is `main`, an Object instance, and only Module answers
# `include`. This is the RSpec shape: `include SomeModule` at the top level of a spec file is
# RSpec's example-group include, NOT Ruby's Module#include — the SAME NAME, a DIFFERENT CONSTRUCT,
# which is dart's impostor exactly.
include TopLevelModule
extend TopLevelSingletonModule
