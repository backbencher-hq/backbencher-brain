"""M60 — the BASE a class NAMES, and the bases that name nothing (#902's sibling).

`baseClassLeaf` fell through to `namedChild(0)` for any base shape it did not list, so
`class Computed(factory("FB", "a"))` published `extends Computed -> factory` — naming the
FACTORY FUNCTION as the parent class. `Computed` inherits from the anonymous class that
call RETURNS; `factory` is not a class and is not its parent. The differential's oracle
names a base only for `identifier`, `subscript` and `attribute`, so the edge was the
python lane's next UNEXPLAINED edge (cython, Tools/dataclass_test_data/
test_dataclasses.py:1637, `class T(namedtuple('Tbase', 'a')):`).

MEASURED on the two pinned corpora (cython + requests, 513 files, 1937 base-list
entries): identifier 1762, attribute 130, keyword_argument 24 (PYD6, skipped), subscript
20, call 1 — so this allowlist removes exactly one fabricated edge corpus-wide.
"""
class Base:
    pass


class T:
    pass


def factory(name, fields):
    return Base


class Plain(Base):
    pass


class Generic(Base[T]):
    pass


class Keyword(Base, total=False):
    pass


class Computed(factory("FB", "a")):
    pass
