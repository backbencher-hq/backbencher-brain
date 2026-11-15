package ImportItems;

use strict;
use warnings;

# 1. A top-level `=>` is a key/value SPECIFICATION, not a list of names to import.
#    `q{""}` is which overload slot; `as_string` is the HANDLER this file must
#    define; `bool` and `fallback` are slots. None of them is imported. The `=>`
#    is an anonymous token between the list's children, NOT a `fat_comma` node.
use overload (
    q{""}    => 'as_string',
    bool     => sub () { 1 },
    fallback => 1,
);

# 2. Same rule, different shape: one parenthesised pair. Both are legitimate
#    arguments, so both must survive -- the rule is about `=>`, not about parens.
use Parenthesized::Args ('Alpha', 'Beta');

# 3. A single parenthesised argument. 2.0.0's `parenthesized_expression` used to
#    hide this list from the argument lookup entirely, so every parenthesised
#    `use` in the corpora lost its items under a grammar bump.
use Single ('Only');

# 4. CODE IS NOT NAMES. A `?:` branch computes a value; it does not declare an
#    import. Only the two plugins on top are arguments.
use PluginList (
    'Plain::Plugin',
    '+Prefixed::Plugin',
    (eval { 1 } ? ('Conditional::Plugin' => { method_name => 'affe' }) : ()),
);

# 5. CODE IS NOT NAMES, for a call: the bundle name is decided at runtime, so
#    sprintf's FORMAT STRING is not an imported name. This is the single case
#    where the two grammars disagreed across all 5,774 corpus files.
use feature (sprintf(":%vd", $^V));

# 6. A name => source pair list, as `InlineModule` is really used. The keys are
#    names but the VALUES ARE SOURCE CODE, and this fixture pins that the `=>`
#    rule refuses the whole specification rather than half-reading it.
use InlineModule (
    'Inline::Alpha' => q{
        package Inline::Alpha;
        sub baz { 1 }
        1;
    },
);

1;