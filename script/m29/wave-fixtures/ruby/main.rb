#!/usr/bin/env ruby
# PINS the ruby wave fixture pack (M29 wave 3, language-onboarding protocol).
# Uniform wave convention: a Greeter class with a greet method, exercised in
# main, plus a named constant whose references must be resolvable.

class Greeter
  GREETING = "hello"

  def initialize(items)
    @items = items
  end

  def greet
    "#{GREETING} #{@items.length}"
  end
end

g = Greeter.new(["a", "b"])
puts g.greet
puts Greeter::GREETING
