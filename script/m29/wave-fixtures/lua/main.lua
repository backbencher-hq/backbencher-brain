-- PINS the lua wave fixture pack (M29 wave 3, language-onboarding protocol).
-- Uniform wave convention: a Greeter table with a greet method, exercised in
-- main, plus a named constant whose references must be resolvable.

local GREETING = "hello"

local Greeter = {}
Greeter.__index = Greeter

function Greeter.new(items)
  return setmetatable({ items = items }, Greeter)
end

function Greeter:greet()
  return GREETING .. " " .. #self.items
end

local g = Greeter.new({ "a", "b" })
print(g:greet())
print(GREETING)
