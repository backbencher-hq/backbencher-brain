# Forms tree-sitter-r accepts but R REJECTS at runtime. Verified against R 4.4.3:
#   bb -> 2    Error: invalid (do_set) left-hand side to assignment
#   cc ->> 2   Error: invalid (do_set) left-hand side to assignment
# A name on the left of a rightward assignment is a VALUE, not a declaration, so
# the analyzer must publish nothing for any line below.
name_on_left -> 6
super_a ->> 7
# These are the VALID rightward forms and DO bind the right side:
9 -> valid_right
10 ->> valid_super_right
# A function bound rightward is NOT a declaration, and this line used to say it was.
# R's own parser puts the rightward assignment INSIDE the function body, exactly as
# tree-sitter-r does — so `function() 1 -> x` binds nothing, and the analyzer
# publishing nothing here is CORRECT.
#
#   $ Rscript -e 'e <- new.env(); eval(parse(text="function() 1 -> x"), e); ls(e)'
#   character(0)
#
# The grammar agrees, which is why this is a fact about R and not about the wasm:
#
#   $ dump-parse-tree.mts 'function() 1 -> valid_fn_right'
#   program
#     function_definition
#       function (anon)
#       parameters ...
#       binary_operator  op="->"      <- the BODY, not a sibling assignment
#         float
#         identifier
#
# The rightward form binds at file scope only when the value is parenthesised or is
# something the grammar cannot absorb, and those two ARE declarations:
(function() 1) -> valid_fn_right_parens
