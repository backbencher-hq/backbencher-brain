// CONV-CS-1 (#750): chain-root reads. The blind-spot sweep found `return x;`
// emitted ZERO uses edges (bare field read invisible) and that in
// `inner.deeper.leaf` the root `inner` was missing while `deeper`/`leaf`
// emitted. CS-R1 repaired the mechanism; this fixture pins BOTH issue shapes
// verbatim so the exact recorded regression cannot recur silently.
public class W
{
    private int x;
    public int Get() { return x; }
}

public class Inner { public Deeper deeper; }
public class Deeper { public int leaf; }
public class Ch
{
    public Inner inner;
    public int Read() { return inner.deeper.leaf; }
}
