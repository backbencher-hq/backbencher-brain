// The `renders` value for C#: the DYNAMIC RENDER HOST names the COMPONENT it renders.
//
// The corpus measures ZERO such sites - the component-render construct itself is RAZOR's, a
// different language with a different grammar - so this fixture is the BEHAVIOURAL PROOF that the
// construct reaches the analyzer as a REAL NODE (rung R3 of the remedy ladder: the existing
// `invocation_expression` node type carries it, no grammar change): the COMPONENT is named by the
// call - a TYPE ARGUMENT (RenderComponent<Widget>) or a `typeof` ARGUMENT
// (RenderComponent(typeof(OtherWidget))) - and the edge exists only when the analyzer sees that
// node. RenderArgs<Widget> is NOT a render host: a generic call whose type argument names a type
// is not a render, and the forbid pins that refusal.

namespace CSharp.Fixtures
{
    public class Widget
    {
        public string Name { get; set; }
    }

    public class OtherWidget
    {
    }

    public class Panel
    {
        public void RenderWidget(RenderTreeBuilder builder)
        {
            builder.RenderComponent<Widget>();
        }

        public void RenderOther(RenderTreeBuilder builder)
        {
            builder.RenderComponent(typeof(OtherWidget));
        }

        public void NotARender(RenderTreeBuilder builder)
        {
            builder.RenderArgs<Widget>();
        }
    }
}
