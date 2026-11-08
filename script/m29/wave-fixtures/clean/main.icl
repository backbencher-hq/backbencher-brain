// PINS the clean wave fixture pack (M29.R2 wave 3, wave-onboarding lane C).
// Uniform wave convention: record Greeter with function greet, exercised in Start.

module main

import StdEnv

:: Greeter =
    { items :: [String]
    }

newGreeter :: [String] -> Greeter
newGreeter items =
    { items = items
    }

greet :: Greeter -> String
greet greeter =
    "hello " +++ toString (length greeter.items)

Start :: *World -> *World
Start world
    # (console, world) = stdio world
    # console = fwritec (greet (newGreeter ["a", "b"])) console
    = snd (fclose console world)
