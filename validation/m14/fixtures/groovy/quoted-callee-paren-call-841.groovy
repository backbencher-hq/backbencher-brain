// M49 G9 (#841): a PARENTHESISED call whose callee is a single-quoted string.
// Groovy's single-quoted string lexes as `character_literal` (the #742 residual —
// it is not Java's one-character char), and `method_invocation`'s two `name`
// choices listed `string_literal` but not `character_literal`, so the paren form
// of a quoted callee had no rule at all and the enclosing construct collapsed.
//
// The command (paren-less) form always worked, because `_juxt_function_name`
// reaches it through `$.primary_expression` — that asymmetry is what makes this
// a grammar gap rather than a lexer one, and it is why `"$quoted"(...)` (a real
// string_literal) parsed while `'$quoted'(...)` did not.
class MappingCfg {
    static mappings = {
        '/500'(view: '/error')
        '/404'(view: '/notFound')
        'in'(list)
        '*'(value)
        'user-type'(name: 'x')
        "double"(view: '/x')
        '/command' view: '/byCom'.length()
    }

    void controls() {
        def quoted = '/quoted'
        def s = 'name'(1)
        def t = "$quoted"(2)
        def u = 'in'(3)
    }
}
