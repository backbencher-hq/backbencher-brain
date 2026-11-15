package com.example.types;

/**
 * EXPORTS_JAVA2 fixture: every type-node shape whose SPELLING is not a name.
 *
 * A `scoped_type_identifier` carries its scope as a nested node, so reading
 * `.text` returns source text rather than a name, and an endpoint built from it
 * cannot join to anything. Measured on java-lib's 3,275 files: 145 such
 * endpoints, in the shapes below.
 *
 * Each declaration is paired with a plain one so the fixture also pins the
 * UNCHANGED spelling — a base-name walk that over-stripped would be caught here
 * too, not only the one that under-stripped.
 */
public class TypeSpellings {
    // generic scope: `Red<String>.Yellow` -> Red.Yellow
    Red<String>.Yellow genericScope;

    // type-use annotation on a scope segment: `java.util.@Nullable Optional`
    // -> java.util.Optional
    java.util.@Nullable Optional annotatedScope;

    // nested qualifiers with NO generics anywhere: already a name, must be
    // unchanged — `Map.Entry` and `Spliterator.OfInt`
    Map.Entry plainNested;
    Spliterator.OfInt plainNested2;

    // annotated type + array brackets on a CAST target: `@Nullable V[]` -> V
    @Nullable V[] annotatedArray;

    // a type argument is a SEPARATE reference with its own site, and must
    // survive: `LinkedHashMultimap<String, Integer>.ValueSet` contributes
    // LinkedHashMultimap.ValueSet AND String AND Integer, not one fused name.
    LinkedHashMultimap<String, Integer>.ValueSet genericScope2;

    void castTargets(Object o) {
        Widget w = (@Nullable Widget[]) o;
        use(w);
    }

    // `Foo[].class` — a class literal over an ARRAY type. The array_type was
    // missing from the type-node search, so this emitted NO edge at all, which
    // also left javaTypeBaseName's array_type branch unreachable from every
    // emission site. Both are pinned here.
    Class<?> arrayClassLiteral() {
        return Widget[].class;
    }

    private static void use(Object o) {}
}