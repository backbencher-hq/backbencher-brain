"""A type-holding NAME bound in the enclosing function is not a class name.

The runtime type these three functions test against is decided by a dict lookup, a caller, or an
`if` — and in every case the name is bound by the ENCLOSING FUNCTION, so python's LEGB rule
resolves it there and no project-wide declaration exists for the edge to reach.
"""

import typing

registry: dict = {}

ModuleFlag: typing.Callable[[], bool] = lambda: True


def module_scoped(obj: object) -> bool:
    """CONTROL: a module-level name used the same way — the position stays the reason."""
    return isinstance(obj, ModuleFlag)


def walrus_check(obj: object) -> bool:
    """PY-D15: the second argument is a WALRUS TARGET of the condition it sits in."""
    if (kind := registry.get("kind")) and isinstance(obj, kind):
        return True
    return False


def param_check(obj: object, plugin_class: object) -> bool:
    """PY-D15: the second argument is a PARAMETER, so the caller decides the type."""
    return isinstance(obj, plugin_class)


def typed_local(obj: object) -> bool:
    """The same local name, twice: once as an ANNOTATION and once as a tested type."""
    kind: type = type(obj)
    return isinstance(obj, kind)


def dynamic_base(use_py: bool):
    """PY-D15 on the BASE axis: `base` is a local, so the base class is chosen at runtime."""
    base = dict if use_py else ModuleFlag
    extra: base = None

    class Row(base):
        pass

    return Row


class NormalBase:
    pass


class Child(NormalBase):
    """CONTROL: an ordinary module-level base, so the code above must not appear here."""
