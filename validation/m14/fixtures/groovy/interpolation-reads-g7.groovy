// G7: Groovy string interpolation, and the contract it must obey.
//
// Before the grammar fix, Java's `string_fragment` token swallowed `$` and `{`
// as opaque text and `string_interpolation` was Java's text-block `'\{'` form,
// so NOTHING inside a GString reached the analyzer: `${style}` produced no read,
// `${user.notify()}` no call, and the nested-quote subset did not even parse.
//
// The contract pinned here, in one file so the controls sit beside the claims:
//   * a FREE name in interpolation is a READ (that is the whole point of the
//     interpolation — the developer expects it to resolve);
//   * a name the current callable BINDS (parameter, local, closure `it`) is NOT
//     a graph node, so it must NOT be read — otherwise the fix would fabricate
//     an edge for every `"$it"` in the corpus;
//   * a member or call in interpolation behaves EXACTLY as the same expression
//     outside a string (handled by the field-access and call walks);
//   * SINGLE-quoted strings never interpolate, so they are the negative control.
class Notifier {
    String templateField
    String style

    String render(user, count) {
        def local = 'x'
        def a = "free ${templateField} and $style"
        def b = "member ${user.name} and call ${user.notify()}"
        def c = "bound ${local} and $count"
        def d = { -> "$local" }
        return a + b + c + d
    }

    String control() {
        // single quotes: no interpolation, so no reads at all
        def e = '${templateField} $style'
        return e
    }

    String nestedBinding() {
        def inner = { ->
            def outerLocal = 'y'
            return "$outerLocal"
        }
        return "$templateField"
    }

    // A closure's implicit `it` is BOUND without being written down, so `"$it"`
    // must not become a read either — this is the single most common Groovy
    // interpolation and the one a naive fix would fabricate thousands of edges for.
    String implicitIt(items) {
        return items.collect { "<$it>" }.join(',')
    }

    // The nested-double-quote class, in the spelling the corpus actually uses:
    // a RAW `"` inside the `${}` body (`${x == "1" ? ' selected="selected"' : ''}`
    // — Grails' FormTagLib writes exactly this, and so does
    // GroovyPagesTemplateEngineTests). Escaping the inner quotes is NOT
    // equivalent source: it lexes as an escape_sequence and never reaches the
    // interpolation, so the raw form is the one that has to parse.
    //
    // `selected` and `label` are parameters, so a read for either would be a
    // fabrication; `registry.lookup("G7")` is owned by the call walk, so it must
    // emit its call and NOT leak a `uses -> lookup`.
    String optionTag(label, selected, registry) {
        return "<option${selected ? ' selected="selected"' : ''}>${label}/${registry.lookup("G7")}</option>"
    }

    // The SLASHY form (G7's second half): a slashy string interpolates exactly
    // like the double-quoted family — both syntaxes, one line, so they cannot
    // diverge unnoticed. `templateName` is a FREE name; the corpus shape this
    // comes from is GspTagSourceMacro.groovy:70,
    // `dir.traverse(nameFilter: /${className}.groovy/)`, where the class name is
    // not a binding of the enclosing scope. The bound case is pinned in the same
    // method: `className` here IS the parameter, so `$className` (line 75's
    // `/end$/ + className…` aside — that is an ordinary argument) must emit
    // NOTHING — the contract is the binding test, not the string form. The
    // ANCHOR (`/end$/`) stays literal text, never a read of `end`.
    String slashyFilter(className) {
        def pattern = /${templateName}.groovy/$className
        def anchored = /end$/ + className.isEmpty()
        return pattern + anchored
    }

    // G7 also closed the parenthesised ARRAY-TYPE map key: `[(Byte[]): v]` used
    // to be an ERROR (it is a real idiom in type-registry maps) while
    // `[(Integer): v]` worked only because `Integer` is also an expression.
    // Written LAST so the whole class body still has to survive it.
    def typeMap() {
        return [(Byte[]): 'bytes', (Integer): 'int', (String): 'str']
    }
}
