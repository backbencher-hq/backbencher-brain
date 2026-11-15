// M60 R10 sibling fixture — the groovy lane of the same class.
//
// groovy builds an override endpoint the same way java does
// (`${ownerFqn}.${name}${signature}`, real-groovy-analyzer.ts buildFqn +
// resolveOverrides) and localized it with the same two-segment dot split, so
// the parameter list is part of the string being split here too. Its pre-fix
// rule cut at the FIRST '(' before splitting — immune to the
// qualified-parameter split below, but it truncates a paren-bearing owner
// chain instead.
//
// Parameter types are written QUALIFIED on purpose: the signature carries the
// written text, so an unqualified `Criterion` would not exercise the class.

package acme.jvm

class Entity {}

class Outer {
    static class Criterion {}

    interface IQuery {
        int query(Entity entity, Outer.Criterion criterion, StringBuilder q, boolean allowJoins)
        boolean remember(java.util.Map.Entry<String, Boolean> eldest)
    }

    static abstract class Builder implements IQuery {
        @Override
        int query(Entity entity, Outer.Criterion criterion, StringBuilder q, boolean allowJoins) {
            return 0
        }

        @Override
        boolean remember(java.util.Map.Entry<String, Boolean> eldest) {
            return false
        }
    }
}
