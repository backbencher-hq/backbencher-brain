"""A BUILTIN BASE AND A BUILTIN ANNOTATION ARE THE INTERPRETER'S NAMES.

`Exception` in a class header and `dict` in an `isinstance` are names the interpreter owns, and
no project declaration can answer them. The analyzer now states that on the key the arbiter reads
(`metadata.languageNamespace`), and the two negative rows below say what the claim is NOT
attached to: a member read whose leaf merely SPELLS a builtin, and a name the file itself binds.
"""


class MyError(Exception):
    pass


def check(x):
    return isinstance(x, dict)


def read(h):
    return h.dict


def shadow(type):
    return isinstance(None, type)


def typed(h):
    return isinstance(None, h.dict)
