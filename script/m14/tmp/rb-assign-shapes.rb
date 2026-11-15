# frozen_string_literal: true

# The known-shape set for `isRubyInstanceVariableWrite`.
#
# reviews/ruby/m60-deep-round.md §9a records that this round's first probe
# over-counted the multiple-assignment defect 7x because its predicate took
# "any variable anywhere in the assignment's LHS subtree" — which also catches
# the two forms below that genuinely READ their receiver. A predicate is only
# trustworthy once it has been shown to agree with a hand-checked set, so the
# set lives here instead of in a scratch file that a /tmp cleanup removes.
#
# The five shapes, and the truth about each:
#
#   @height, @width = h, w     left_assignment_list > ivar   FALSE read  (write)
#   @department, * = x         left_assignment_list > ivar   FALSE read  (write)
#   @cfg.limit = x             call > ivar                    a REAL read (receiver)
#   @list[i] = v               element_reference > ivar       a REAL read (receiver)
#   @mode ||= v                operator_assignment > ivar     a REAL read (RMW, SCD1)
#
# You cannot assign through a receiver without reading it, which is the whole
# reason the last three are not swept in with the first two.

class Shapes
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
end
