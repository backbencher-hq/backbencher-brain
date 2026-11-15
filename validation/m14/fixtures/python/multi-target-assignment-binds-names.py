"""PY-D21 (round 11) — a MULTI-TARGET assignment binds EVERY name in its pattern.

`extractAssignment` gated on `left.type === "identifier"`, so `a, b = f()` bound nothing at all.
The name this was found on is a real corpus one: `helloworld_pb2, helloworld_pb2_grpc =
grpc.protos_and_services("helloworld.proto")` at module scope in the grpc examples, where every
annotation naming `helloworld_pb2` was an UNEXPLAINED reference to a binding written two lines above.

The shapes below are every spelling the grammar produces (`.tmp-py/round11-shapes.mts`), and the
function/class rows are the SCOPE half: the same pattern binds a module name, a class member, or a
function local, and only the first two are symbols.
"""

PAIR = make_pair()


def make_pair():
    return (1, 2), (3, 4), 5


FIRST, SECOND = make_pair()
(a, (b, c)) = make_pair()
[d, e] = make_pair()
f, *rest = make_pair()
g = h = make_pair()
p, q: int = 1, 2


class Holder:
    x, y = 1, 2

    def method(self):
        m, n = make_pair()
        sb, *tail = make_pair()
        return m, n, sb, tail


def calls_the_module_bindings():
    return FIRST(SECOND)


class Annotates:
    field: FIRST


def calls_the_class_members():
    return Holder.x()


def calls_the_locals():
    m, n = make_pair()
    return m(n)
