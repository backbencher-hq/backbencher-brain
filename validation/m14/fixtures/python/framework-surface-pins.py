"""M60.R8 (#747) — the python framework trigger surface.

Before this round the context carried a `frameworks: Record<string, boolean>` field that
NOTHING ever wrote, while the emitter published `hasFrameworkIntelligence: true` on every
file. A minimal Django model and a minimal Flask app both detected `[]`, and 0 of 187
real corpus files ever detected anything.

The import order below is deliberate: pytest comes FIRST, django second. The contract
orders detection by the marker table (application frameworks first, test frameworks last —
csharp's CS_FRAMEWORK_ORDER rule), so the primary pick must be Django and not pytest. If
the analyzer ever goes back to emitting in import order, this fixture fails on both the
array and the primary pick.
"""
import pytest

from django.db import models
from flask import Flask

app = Flask(__name__)


class User(models.Model):
    """A Django model: `models` comes from django.db, so the ROOT module is `django`."""

    name = models.CharField(max_length=10)


def build_app():
    return app


def test_user():
    assert build_app() is not None
