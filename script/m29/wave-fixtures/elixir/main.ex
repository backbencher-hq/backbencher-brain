# PINS the elixir wave fixture pack (M29 wave 3, language-onboarding protocol).
# Uniform wave convention: a Greeter module with a greet function, exercised in
# main, plus a named constant whose references must be resolvable.

defmodule Greeter do
  @greeting "hello"

  def greet(items) do
    @greeting <> " " <> Integer.to_string(length(items))
  end
end

defmodule Main do
  def run do
    IO.puts(Greeter.greet(["a", "b"]))
  end
end
