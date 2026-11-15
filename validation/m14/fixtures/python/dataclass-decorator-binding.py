import other_library
import dataclasses as dc
from dataclasses import dataclass as model
from other_library import dataclass


class Payload:
    def send(self):
        pass


@other_library.dataclass
class QualifiedNamesake:
    body: Payload

    def qualified_namesake(self):
        return self.body.send()


@dataclass
class ImportedNamesake:
    body: Payload

    def imported_namesake(self):
        return self.body.send()


@dc.dataclass()
class StandardModuleAlias:
    body: Payload

    def module_alias(self):
        return self.body.send()


@model
class StandardItemAlias:
    body: Payload

    def item_alias(self):
        return self.body.send()


@late_model
class BeforeImport:
    body: Payload

    def before_import(self):
        return self.body.send()


from dataclasses import dataclass as late_model
from dataclasses import dataclass as rebound_model


def rebound_model(cls):
    return cls


@rebound_model
class AfterRebinding:
    body: Payload

    def after_rebinding(self):
        return self.body.send()
