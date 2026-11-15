from mymod import Foo, Baz


class TypeGraph:
    prop: dict[str, Foo]
    plain = 5

    def method(self, param: list[Foo], opt: str = "x") -> Baz | None:
        local: Foo = param
        ok = isinstance(param, Baz)
        return local
