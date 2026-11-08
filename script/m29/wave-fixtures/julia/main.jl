# PINS the julia wave fixture pack (M29 wave 3, language-onboarding protocol).
# Uniform wave convention: a Greeter module with a greet method, exercised in
# main, plus a named constant whose references must be resolvable.

module Greeter

const GREETING = "hello"

greet(items) = GREETING * " " * string(length(items))

function main()
    println(greet(["a", "b"]))
    println(GREETING)
end

end # module
