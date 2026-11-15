# fixture: python/owner-evidence-classes
# The owner channel (`metadata.owner`, read by src/ast/member-owner-resolution.ts) extended
# beyond `self`/`cls`: a PARAMETER ANNOTATION and a SINGLE CONSTRUCTOR ASSIGNMENT prove the
# receiver's type, so a member call/read through that receiver can be resolved through the
# owner and its ancestors. A receiver whose type is not written down, or written down twice,
# carries NO owner — a wrong owner is worse than a missing one, because the store withdraws
# the name binding for owner-carrying rows and then declines.
class Widget:
    def render(self):
        return 1

    def paint(self):
        return self.render()


def from_annotation(x: Widget):
    return x.render()


def from_assignment():
    w = Widget()
    return w.render()


def from_with():
    with Widget() as w2:
        return w2.render()


def unproven(z):
    return z.render()


def rebound():
    q = Widget()
    q = make_other()
    return q.render()


def param_then_rebind(x: Widget):
    x = make_other()
    return x.render()


def make_other():
    return Widget()


def read_annotation(x: Widget):
    return x.render


class Other:
    pass


def make_widget():
    return Widget()


def from_optional(x: Optional[Widget]):
    return x.render()


def from_forward(x: "Widget"):
    return x.render()


def from_union_none(x: Widget | None):
    return x.render()


def from_annotated_local():
    z: Widget = make_widget()
    return z.render()


def from_container(xs: list[Widget]):
    return xs.render()


def from_two_classes(a: Union[Widget, Other]):
    return a.render()


# ── DATACLASS FIELD TYPES (the `field` evidence class) ──────────────────────────────────────
# A two-dot receiver `self.body.send()` names a field of the enclosing class AND the field's
# declared type. On a `@dataclass` the class-body annotation IS the language's field declaration
# (the decorator generates `__init__` from it), so the owner of the member call is the FIELD'S
# TYPE. A plain (non-dataclass) class annotation is only a type-checker hint at runtime, so it is
# refused; a CONTAINER field is the container, not its element, so it is refused too.
from dataclasses import dataclass


@dataclass
class Payload:
    def send(self):
        return 1


@dataclass
class Envelope:
    body: Payload
    tags: list[Payload]
    maybe: Optional[Payload]

    def forward(self):
        return self.body.send()

    def forward_read(self):
        return self.body.send

    def optional_field(self):
        return self.maybe.send()

    def container_field(self):
        return self.tags.append

    def plain_self_field(self):
        return self.body


class NotADataClass:
    body: Payload

    def forward(self):
        return self.body.send()


# ── CONTAINER-ELEMENT TYPING (the `annotation-element` evidence class) ──────────────────────
# The receiver of `x.render()` is `x`, whose binding is the FOR TARGET: python's own rule is that
# a for target binds the ITERABLE'S ELEMENT, and the iterable's annotation states that element.
# Deliberately narrow — the annotation types the ELEMENT, never the container (`xs.render()`
# stays refused), and a loop that rebinds its own variable makes the receiver a maybe again.
def from_container_iteration(xs: list[Widget]):
    for item in xs:
        item.render()


def from_container_read(xs: list[Widget]):
    for item in xs:
        return item.render


def from_tuple_iteration(xs: tuple[Widget, ...]):
    for item in xs:
        item.render()


def from_container_rebound(xs: list[Widget]):
    for item in xs:
        item = make_other()
        item.render()


def from_container_two_targets(xs: list[Widget]):
    for a, b in xs:
        a.render()


def from_untyped_container(xs: list):
    for item in xs:
        item.render()


# ── MODULE-QUALIFIED CONSTRUCTOR (the same `assignment` evidence class, qualified spelling) ──
def from_qualified_assignment():
    import container_shapes
    w = container_shapes.Widget()
    return w.render()


def from_qualified_factory():
    import container_shapes
    q = container_shapes.make_widget()
    return q.render()
