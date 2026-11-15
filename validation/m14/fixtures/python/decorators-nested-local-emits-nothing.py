# fixture: python/decorators-nested-local-emits-nothing
# A decorator on a LOCAL (nested) def has no published declaration to be applied
# to: `def nested` inside `def outer` is a local on this family's contract (PY-28),
# and the Lead's ruling for the `decorates` emission is NO ROW — not even one
# re-attributed to the enclosing symbol, because a decorator is part of the
# decorated declaration's identity, not a fact about the body that contains it.
def outer():
    @inner_deco
    def nested():
        return 1
    return nested


class Holder:
    def method(self):
        @inner_deco
        def local():
            return 2
        return local
