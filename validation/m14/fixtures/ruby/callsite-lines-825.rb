# ruby/callsite-lines-825.rb — M59.A7 (#825) line-round pins for the ruby lane.
#
# Every expected line below is the line where the edge's TARGET is written.
#
# Three shapes are BOTH a line pin and a semantics pin:
#   * a chain wrapped one call per line — a receiver-line stamp is the defect;
#   * a WRAPPED superclass (`class X <\n  Base`) — the `superclass` node starts
#     at `<`, so stamping its node puts the edge one line above the base;
#   * a VARIABLE receiver (`@factory.new`) — no class name is written anywhere,
#     so the edge must be the member call `new`, never `instantiates <a class>`.
require "json"

module Pin
  class Base
    def greet
      "hi"
    end
  end

  # A dynamic superclass is not a class NAME: no `extends`, and no `overrides`
  # edge may name the expression.
  class Wide < Struct.new(:a, :b)
    def each
      yield
    end
  end

  class Widget <
    Base
    def greet
      "hello"
    end

    def assemble
      helper
        .strip
        .upper
      @repo.count
      @factory.new
      Part.new
      self.new
      alias_method :old_assemble, :assemble
      include Comparable
    end
  end
end
