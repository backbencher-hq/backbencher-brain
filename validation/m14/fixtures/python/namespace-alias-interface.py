import abc as abc_alias
import collections.abc as cabc


class AbstractThing(abc_alias.ABC):
    pass


class MappingThing(cabc.Mapping):
    pass


cabc.Sequence.register(AbstractThing)
