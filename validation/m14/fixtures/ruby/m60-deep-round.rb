# frozen_string_literal: true

# M60 deep round (ruby). Two defects this wave measured on three heavy Rails
# corpora this lane had never been run against (rails 3,468 / rubocop 1,780 /
# mastodon 3,266 .rb files; 4,024,840 named nodes) via
# script/m14/tmp/rb-corpus-census.ts.
#
# SIG-A — a name a PARAMETER DEFAULT assigns is a local of the method.
# Ruby evaluates a default expression in the method's own scope, so `seen`
# below is a local variable of `scoped`, not a method. The analyzer walked
# default VALUES (RB-B) but never fed the names those values BIND back into
# the body walk, so `return nil if seen` was published as `calls scoped ->
# seen`. Measured: rails activerecord/lib/active_record/scoping/named.rb:23,
# where the analyzer invented a call to `all_queries_not_set` — a name the
# very signature on line 22 binds.
#
# The other half of the same rule must keep working: a default that CALLS
# something is a real call site. `scoped` also takes `build_lock`, and a
# naive fix (suppress calls in defaults) would satisfy the SIG-A forbid by
# deleting a real call — which is why `build_lock` is pinned positively.
def scoped(query, seen = (marker = true), build_lock = build_lock())
  return nil if seen
  return nil unless build_lock
  marker
end

# SIG-B — an ANONYMOUS dynamic class. `anon` is a LOCAL, so the block's
# members belong to a class that has no name, and an edge written against the
# enclosing named class is a misattribution. The owner is deliberately NOT
# reparented (a local has no symbol, so that trades a false edge for a
# dangling one, and the differential has no truth for an anonymous scope to
# check against); the binding is DECLARED on the member instead.
#
# Two forms, because the analyzer reaches them by different paths: the
# class-body form through the top-level walk's frame, and the method-body form
# through walkBody. rails writes the second one inside test METHODS (24
# association edges in activerecord/test/cases/associations alone), so a fix
# that only covered the first would have measured 0 on the corpus that
# motivated it.
#
# The nesting is the load-bearing part: `belongs_to :widget` sits in the INNER
# anonymous class and `has_many :parts` in the OUTER one, so a resolution that
# took the outermost (or the first-registered) binding would mis-declare one of
# them. rails writes exactly this shape
# (activerecord/test/cases/associations/has_many_associations_test.rb:138-146).
class Factory
  K = Class.new(Base) do
    def self.build
      new
    end
  end

  at_body = Class.new(Base) do
    belongs_to :outer_thing

    def ping
      1
    end
  end

  def make
    anon = Class.new(Base) do
      belongs_to :widget

      inner = Class.new(Base) do
        belongs_to :deep_thing
      end

      has_many :parts
      inner
    end
    anon
  end
end

# FIX-4 — a BARE `private` / `protected` / `public` is a visibility directive,
# not a call. `private :helper` (a `call` node) was always handled; the bare
# keyword parses as a plain `identifier`, and the top-level walk has skipped it
# since this file's first version — but `pushBareCall`, which serves METHOD
# bodies, never carried the rule, so a bare `private` inside a method or block
# was published as `calls <method> -> private`. Measured 3 times in a
# 1,200-file stride sample of three corpora (rails timestamp_test.rb:229, rails
# try_test.rb:80, mastodon csp_spec.rb:33), and the oracle already filtered
# them, so the analyzer was the only side publishing.
class Guard
  def reveal
    private
    1
  end
end

# FIX-5 — `|(head, *body)|` binds `body` too. The bound name is not always a
# DIRECT child of `destructured_parameter`: a splat wraps it, and the pre-scan
# read direct children only, so every use of the splat-bound name became a
# fabricated bare call. Measured on rubocop
# lib/rubocop/cop/cop_documentation.rb:65, which published
# `calls tagged_sections -> body` for a block parameter.
class Sectioner
  def sections(lines)
    lines.slice_before { |line| line.match?(/x/) }.map do |(head, *body)|
      [head, body]
    end
  end
end

# FIX-6 — a WRITE target is not a READ. `isRubyInstanceVariableWrite`, ONE
# predicate shared by the two analyzer sites that previously each carried their
# own copy of a two-line test.
#
# The multiple-assignment form escaped because the target's parent is the LIST,
# never the `assignment`: `@a, @b = 1, 2` parses as
# `assignment > left_assignment_list > instance_variable`. Compound assignment
# (`@n ||= v`) was already handled under SCD1.
#
# The three shapes below are the reason a naive fix is wrong, and they are here
# because they are the check on the fix: you cannot assign through a receiver
# without READING it, so `@cfg.limit = x` and `@list[i] = v` are real reads. A
# first draft of this fix took "anything in the LHS subtree" and over-counted the
# defect 7x for exactly that reason (review §9a).
class AssignmentShapes
  def multiple(h, w)
    @height, @width = h, w
    [@height, @width]
  end

  def splatted(name)
    @department, * = name.rpartition('/')
    @department
  end

  def attribute(x)
    @cfg.limit = x
    @cfg
  end

  def element(i, v)
    @list[i] = v
    @list
  end

  def compound(v)
    @mode ||= v
    @mode
  end

  # Written and NEVER read, which is what makes a blanket `uses` forbid
  # expressible for the write side: `multiple` above reads @height/@width on a
  # LATER line, so a forbid on that target alone would be wrong — the read is
  # real. These two have no read anywhere, so "no `uses` edge exists" is the
  # exact statement the matcher can make.
  def never_read(h, w)
    @ghost, @phantom = h, w
    nil
  end

  # Written THROUGH and never read on any other line. This is the shape that
  # makes the receiver rule load-bearing rather than decorative: `@sink.value = 1`
  # MUST emit `uses -> @sink`, because assigning through a receiver reads it.
  # `attribute` above cannot prove that — it reads @cfg again on the next line,
  # so the expect is satisfied whether or not the predicate keeps the receiver
  # case. Here there is no second read, so dropping the receiver case drops the
  # edge and the expect fails. (A first version of this pin survived both a
  # naive-subtree mutant and a receiver-sweeping mutant for exactly that reason.)
  def written_through(v)
    @sink.value = v
    nil
  end
end

# FIX-7 — a REOPEN is one identity with the nested spelling, at EVERY depth.
# `class Admin::Announcements::DistributionsController` split on the FIRST `::`
# produced a symbol NAMED `Announcements::DistributionsController` owned by
# `Admin`, while the nested spelling produces name `DistributionsController`
# under Admin > Announcements. The two spellings of the same class never
# unified -- the exact failure RUBD13 was filed to prevent, which held by
# accident only because first == last for a two-segment reopen.
# Measured over 1,200 files: 58 non-leaf names (mastodon 32, rails 26).
class Admin
  class Announcements::DistributionsController
  end
end

module Outer
  module Inner::Deep
  end
end

# A THREE-segment reopen, which is the only shape that can tell a LAST-separator
# split from a FIRST-separator one: for `Announcements::DistributionsController`
# the two coincide, which is why the first version of this pin survived the exact
# mutation it was written for.
class Alpha::Beta::Gamma
end

# FIX-8 — a define_method name built by interpolation is a TEMPLATE, not a name.
# `define_method("#{sym}?")` names a method only at runtime; the graph gained a
# symbol literally called `#{sym}?` resolving to no method in any file. R7's
# placeholder-name doctrine: a symbol name must name something. Nothing is
# emitted, which is the silence `define_method(some_var)` already gets.
class DynamicName
  [:a, :b].each do |sym|
    define_method("#{sym}?") { 1 }
  end

  define_method(:real_one) { 2 }
end

# FIX-9 — an INTERPOLATED require path is a TEMPLATE, not a path. The autoload
# branch's own comment has said since it was written that it takes "string paths
# only (dynamic paths are unresolvable, mirroring require)"; the check was only
# `type === "string"`, and an interpolated path IS a string. 217 sites.
class DynamicRequire
  autoload :Widget, "#{__dir__}/widget"
end

require "#{__dir__}/dynamic_helper"

# FIX-10 — an EXPRESSION receiver constructs an ANONYMOUS class, so there is no
# nameable target. The guard existed but sat BELOW the emit, and `target` falls
# back to `owner`, which is truthy for any capitalized class — so
# `Class.new(Foo).new` inside a class published `instantiates <Enclosing> ->
# <Enclosing>`, an edge claiming the class constructs itself, on a line that does
# not contain its name. 118 inconsistent `instantiates` on 3,000 files.
# `self.new` must still resolve to the enclosing class: `self` is a NAMED node
# in this grammar, so it is excluded from the expression-receiver set explicitly.
class AnonymousConstruction
  def build
    Class.new(Base).new
  end

  def rebuild
    self.new
  end
end

# FIX-11 — a macro member's range is its ARGUMENT, not the call. A multi-line
# `attr_accessor` gave every property the line the call starts on, so the derived
# `contains` edge claimed a line that does not contain the member.
class WrappingMacro
  attr_accessor :first_attribute,
                :second_attribute,
                :third_attribute

  # The `scope` site needs its argument on a DIFFERENT line from the call before
  # it can tell `firstArg` from `node` at all: in the ordinary one-line shape
  # both start on the same row, so reverting that site changed nothing a
  # fixture could see. A mutant that passes for that reason is not a surviving
  # pin, it is a pin that was never load-bearing.
  scope(
    :wrapped_scope,
    -> { order(id: :desc) }
  )
end

# FIX-12 — the require family is RECEIVERLESS. `require`, `require_relative`,
# `load` and `autoload` are Kernel/private methods invoked with no receiver, so
# `require "x"` loads a file and `coder.load("--- ")` is some object's method that
# shares the name. The branch matched on the NAME alone, so real code published
# `references` edges naming document fragments. Both a NAMED receiver and an
# EXPRESSION one must be excluded: an expression receiver leaves `receiver`
# unset, so a receiver-only guard still let `serializer(x).load("")` through with
# an EMPTY target.
class ReceiverLoad
  def call(coder, payload)
    coder.load(payload)
    serializer(coder).load("")
    coder.autoload :Thing, "some/autoload/path"
    load "real/require/path"
  end
end

# FIX-13 — an association macro's argument must be a LITERAL name. `belongs_to
# role` where `role` is a method PARAMETER published a `uses` edge and a
# `Property` SYMBOL named after the local — a class that has no such method.
# The analyzer already refuses exactly this for `include`/`extend`/`prepend`
# ("a DYNAMIC mixin — the concrete module is unknowable"); the association family
# was never held to its sibling branch's standard. Found by the exact M60 line
# audit, where these were 20 of 22 violations over all 8,528 files, as
# `contains -> name` and `contains -> role` claiming a class contains its own
# parameter. Both a parameter and a plain local must be silent; the literal forms
# must be unaffected.
class DynamicAssociationName
  def delegated_type(role)
    belongs_to role, polymorphic: true
  end

  def build(name, scope)
    has_many name, scope
  end

  def literals
    belongs_to :account
    has_many :parts, -> { where(active: true) }
    belongs_to "author"
    self.belongs_to :via_receiver
  end
end
