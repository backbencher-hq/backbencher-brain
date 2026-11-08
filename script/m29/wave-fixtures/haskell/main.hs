-- PINS the haskell wave fixture pack (M29 wave 3, language-onboarding protocol).
-- Uniform wave convention: a Greeter type with a greet function, exercised in
-- main, plus a named constant whose references must be resolvable.

module Greeter (Greeter (..), greet, greeting) where

data Greeter = Greeter [String]

greeting :: String
greeting = "hello"

greet :: Greeter -> String
greet (Greeter items) = greeting ++ " " ++ show (length items)

main :: IO ()
main = do
    putStrLn (greet (Greeter ["a", "b"]))
    putStrLn greeting
