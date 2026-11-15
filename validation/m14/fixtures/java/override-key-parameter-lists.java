package com.acme.jvm;

// M60 R10 — the java override-KEY class. Authored before the analyzer run.
//
// An override endpoint is built as `${ownerFqn}.${name}${signature}`, so the
// emitted label comes from splitting a string that CONTAINS a parameter list.
// The pre-fix rule (split on '.', keep the last two segments, cut each at '(')
// split the parameter list itself whenever a parameter TYPE was written with a
// dot, so the label was not a name at all. Measured on real corpora
// (grails-core `JpaQueryBuilder.java`, `GrailsResourceUtils.java`), and
// reproduced here in-file so the end-to-end path is pinned:
//
//   query()'s    (Entity,Outer.Criterion,StringBuilder,boolean)  ->  `query.Criterion,StringBuilder,boolean)`
//   remember()'s (java.util.Map.Entry<String, Boolean>)          ->  `remember.Entry<String, Boolean>)`
//   last()'s     (Outer.Criterion)                               ->  `last.Criterion)`
//
// The parameter types are therefore written QUALIFIED on purpose — the
// signature carries the written text, and an unqualified `Criterion` would not
// exercise the class at all.
//
// The second half of the same class is why the rule is shared rather than one
// cut: `split("(")[0]` is immune to the split above, but truncates an owner
// chain that itself carries a call (`Child.getInner().anonymous_Inner.foo`) to
// `Child.getInner` — a name, but the wrong one, and silently so.

class Entity {}

class Outer {
    static class Criterion {}

    interface Query {
        int query(Entity entity, Outer.Criterion criterion, StringBuilder q, boolean allowJoins);
        boolean remember(java.util.Map.Entry<String, Boolean> eldest);
        void last(Outer.Criterion criterion);
    }

    static abstract class Builder implements Query {
        @Override
        public int query(Entity entity, Outer.Criterion criterion, StringBuilder q, boolean allowJoins) {
            return 0;
        }

        @Override
        public boolean remember(java.util.Map.Entry<String, Boolean> eldest) {
            return false;
        }

        @Override
        public void last(Outer.Criterion criterion) {}
    }
}
