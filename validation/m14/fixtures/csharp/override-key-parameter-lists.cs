// M60 R10 sibling fixture — the csharp lane of the same class.
//
// csharp builds an override endpoint the same way java does
// (`${ownerFqn}.${name}${signature}`, real-csharp-analyzer.ts:1436-1439), so the
// parameter list is part of the string the edge label is derived from here too.
// Its pre-fix rule cut at the FIRST '(' before splitting on dots, which is
// immune to the qualified-parameter split pinned here, but TRUNCATES a
// paren-bearing owner chain instead — the same class, mirrored. Both lanes now
// call one shared rule (src/ast/override-context.ts localEdgeLabel).
//
// Parameter types are written QUALIFIED on purpose: the signature carries the
// written text, so an unqualified `Criterion` would not exercise the class at
// all. The base method is abstract and the derived one says `override` because
// that — not interface implementation — is what the csharp lane resolves
// overrides from (an interface-only shape emits no override edge at all;
// measured).

namespace Acme.Jvm;

class Entity {}

class Outer
{
    public class Criterion {}

    abstract class Query
    {
        public abstract int Handle(Entity entity, Outer.Criterion criterion, System.Text.StringBuilder q, bool allowJoins);
        public abstract bool Remember(System.Collections.Generic.KeyValuePair<string, bool> eldest);
    }

    class Builder : Query
    {
        public override int Handle(Entity entity, Outer.Criterion criterion, System.Text.StringBuilder q, bool allowJoins)
        {
            return 0;
        }

        public override bool Remember(System.Collections.Generic.KeyValuePair<string, bool> eldest)
        {
            return false;
        }
    }
}
