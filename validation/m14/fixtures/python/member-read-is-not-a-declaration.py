"""PY-D24 (round 12) — a MEMBER READ is not a name.

`isinstance(x, self._self_owner)` / `issubclass(source.__class__, field.related_model)` /
`isinstance(w.message, passlib_exc.PasslibHashWarning)` all take their type argument from an
attribute of a LOCAL object. The emitter published the last identifier (`_self_owner`,
`related_model`, `PasslibHashWarning`) as the target and the whole spelling as
`metadata.qualified`, so the row named a declaration-like name that no file declares, and the
verdict could only call it UNEXPLAINED — three rows of the round-11 residual, measured.

The gate is the receiver's ROOT, resolved by python's own lexical walk, and the three negative
rows below are what keeps the rule narrow:

  * the RECEIVER leaf (`field` in `field.related_model`) is a local binding, so it must keep
    `local-binding-target` — the first version of this rule relabelled it `member-read`, and the
    probe caught it;
  * an IMPORT-bound root (`os.PathLike`) keeps the `qualified-external` route rather than being
    declared dynamic;
  * a member read still fabricates NO symbol: nothing here is a declaration.
"""

import os


class Config:
    DEFAULTS = 1


def reads_members(self, field, mod, instance, w):
    cfg = Config()
    # The member read is the SECOND argument — the type slot. `isinstance(x, self.y)` is the
    # measured corpus shape; writing it in the first slot would target `object` instead and the
    # fixture would pass while measuring nothing (which is what the first draft of this file did).
    isinstance(instance, self._self_owner)
    issubclass(field.__class__, field.related_model)
    isinstance(w, mod.Thing)
    isinstance(w, cfg.DEFAULTS)
    return self._self_owner, field.related_model, mod.Thing, cfg.DEFAULTS


def import_bound_root(x):
    return isinstance(x, os.PathLike)
