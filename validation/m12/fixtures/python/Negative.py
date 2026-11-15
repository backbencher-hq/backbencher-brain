import math
from functools import reduce

# Locals and params are NOT symbols (module-level symbols only).
def LocalsAreNotSymbols():
    local = 1
    mutable = 2
    return local + mutable


def ParamsAreNotSymbols(a, b):
    return a + b


# Lambda params / comprehension locals are not symbols. The METHOD call on the
# param (`upper`) emits as a leaf target (JS-family contract: `calls ... ->
# join/map/toFixed` in the JS Negative GT).
def LambdaParamsAreNotSymbols(items):
    return [i.upper() for i in items if i]


# Builtins (print/len/str) are filtered — no call edges.
def BuiltinsAreFiltered(x):
    print("noise")
    return len(str(x))


# Imported names emit leaf call targets (module-sourced), but no in-file
# symbol is created for `reduce` and no instantiates fires (not declared).
def ImportedAreNotCalls(xs):
    return reduce(lambda a, b: a + b, xs, 0)


# Decorators are metadata on the symbol, never call edges.
@staticmethod
def DecoratedIsMetadata():
    return 1


# Uppercase module call `math.sin` → leaf `sin` (lowercase leaf, a call); the
# uppercase module name does NOT produce an instantiates (undeclared class).
def ExternalInstantiation():
    return math.sin(0)


# Attribute access (non-call) is not a relationship.
def AttrAccessIsNothing(obj):
    return obj.name


# Nested function is scoped noise (no symbol); the call to it attributes to
# the ENCLOSING function as a leaf target.
def Outer():
    def inner():
        return 1

    return inner()


# dunder method calls on objects are not user call edges.
def DunderIsFiltered(obj):
    return obj.__len__()
