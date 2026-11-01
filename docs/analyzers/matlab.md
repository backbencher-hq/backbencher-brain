# MATLAB analyzer

`RealMatlabAnalyzer` uses the vendored `tree-sitter-matlab` grammar and does
not parse source text with regular expressions. It publishes:

- function and class declarations;
- class properties, events, enumeration members, and nested functions/methods;
- class-section attributes and private/protected visibility where represented by
  the grammar;
- function parameters and declaration ownership;
- class superclass `extends` relationships;
- AST-backed `calls` for `function_call` nodes;
- `uses` relationships for identifiers, assignments, and field receivers.

The grammar intentionally represents MATLAB function calls and matrix indexing
with the same node type. The analyzer therefore records the structural call
evidence but marks targets that are not declared in the file as inferred,
rather than claiming that indexing has been semantically resolved.

MATLAB and Objective-C both use `.m`. The router preserves Objective-C as the
fallback and selects MATLAB only when the file contains an unambiguous
`function` or `classdef` declaration. `.mlx` is not routed because it is a
binary/package format and no parser is vendored for it.

This is a per-file AST analyzer. It does not claim cross-file package
resolution, overload resolution, runtime dispatch, script-variable
declarations, import resolution, or instantiation semantics.
