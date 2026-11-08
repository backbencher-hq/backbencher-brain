<?php
// PINS the php wave fixture pack (M29 wave 3, language-onboarding protocol).
// Uniform wave convention: a Greeter class with a greet method, exercised in
// main, plus a named constant whose references must be resolvable.

const GREETING = "hello";

class Greeter
{
    private array $items;

    public function __construct(array $items)
    {
        $this->items = $items;
    }

    public function greet(): string
    {
        return GREETING . " " . count($this->items);
    }
}

$g = new Greeter(["a", "b"]);
echo $g->greet(), "\n";
echo GREETING, "\n";
