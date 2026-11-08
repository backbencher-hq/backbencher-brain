# PINS the powershell wave fixture pack (M29 wave 3, language-onboarding protocol).
# Uniform wave convention: a Greet function called from Main, plus a named
# constant whose references must be resolvable.

$Greeting = "hello"

function Greet {
    param([string[]] $Items)
    "$Greeting $($Items.Count)"
}

function Main {
    Write-Output (Greet -Items @("a", "b"))
    Write-Output $Greeting
}

Main
