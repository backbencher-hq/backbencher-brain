"""A KEYWORD ARGUMENT'S NAME IS NOT A TYPE — the annotation walk must not descend past it.

`read_token: Annotated[str, Field(min_length=1, strict=True, max_length=2048)]` writes a TYPE
(`str`) and a validator CALL. The walk that derives `references` used to recurse into the call
and publish an edge for EVERY identifier it reached, which included the keyword-argument NAMES:

    references Model -> min_length
    references Model -> strict
    references Model -> max_length

Those names are parameter LABELS. They name no type, bind to nothing in any population, and the
edge asserts the function references a type called `min_length` — a fabricated relationship, and
a measured slice of the UNEXPLAINED incoming targets the resolution verdict named (the openapi
generator's pydantic models write this shape in every API method, `min_length`/`strict` 80+ times
each). The rule is the one `keyword_argument` already teaches everywhere else: the NAME is a
label, the VALUE is the expression. The function being CALLED (`Field`) is still a name the
annotation mentions and is still published; only the keyword names are dropped.

The value is NOT skipped, which is why the fix is a recursion past the name rather than a refusal
of the whole call: a legitimate type can live in a keyword value (`TypeVar("T", bound=Base)`),
and dropping it would trade one fabrication for one loss.
"""

from typing import Annotated

from pydantic import Field


class Model:
    """The openapi-generator shape, reduced to one attribute."""

    read_token: Annotated[str, Field(min_length=1, strict=True, max_length=2048)]
    plain: str
    aliased: Annotated[int, Field(ge=0, le=100)]
