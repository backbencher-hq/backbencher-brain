// Clean fixture: the qualified-name forms, BOTH of them.
//
// The pre-existing `expression-shapes.icl` fixture pins the ALIAS form
// (`M.lookupOne` after `import qualified Data.Map as M`), and it was the lane's
// ONLY qualified-name coverage. Measured over the 320-file Clean universe, the
// pinned grammar emits `qualified_identifier` — the node that form desugars to —
// exactly TWICE, and both sites are this repository's own fixtures. The form real
// Clean code uses is `single_quoted_name`, 233 corpus sites, of which 87 are in
// application-head position, and the pre-round analyzer named the node type
// nowhere.
//
// So the lane's only test exercised a form no Clean codebase contains, and the
// form every Clean codebase uses had no test at all. This fixture is the corpus
// form. Taken from eastwood/src/linter/EastwoodLint.icl, which is where the
// corpus uses it.
//
// A note on the field's name, measured: the grammar cannot read an UPPERCASE record
// field. `:: Config = { Diagnostic :: !Bool }` parses with the `{` as an ERROR node,
// `Diagnostic` as a `data_constructor`, and the field's own `:: Bool` as a SECOND
// `type_definition` — three symbols published for one record. The corpus gets this
// right by convention (a record field is lowercase; `d.Diagnostic.severity` in
// eastwood is a field_access whose FIELD node the grammar also types `constructor`,
// and eastwood's own `Config` is imported, so the shape is never re-parsed). The
// lowercase field below is therefore the shape this fixture can pin, and the
// uppercase one is a classified grammar defect (spec CL-G4) rather than an analyzer
// behaviour to enshrine.
//
// The shapes, all AST-derived:
//   `'Data.Error'.Ok {opts & color = False}`   — a qualified CONSTRUCTOR, and the
//                                                head node's text quotes the MODULE
//                                                only: `'Data.Error'`, then `.Ok`
//   `cfg.diagnostic`                           — a FIELD whose name is a
//                                                `constructor` in the grammar when it
//                                                starts with a capital; see the note
//                                                below on why this fixture's field is
//                                                lowercase
//   `'Data.Error'.MaybeError [String] LineRange` — a qualified TYPE in signature
//                                                position, where the grammar lexes
//                                                the alias as a `constructor` and the
//                                                rest as a `dotted_type`
implementation module CleanQualifiedNames

import StdEnv
import qualified Data.Error
from Data.Error import instance Functor (MaybeError a)

okOr :: !Bool !String -> 'Data.Error'.MaybeError String
okOr flag msg = case flag of
	True  = 'Data.Error'.Ok msg
	False = 'Data.Error'.Error [msg]

:: Config = { diagnostic :: !Bool }

severityOf :: !Config -> !String
severityOf cfg = toString cfg.diagnostic

classify :: !String -> !String
classify line = case line of
	_ = toString ('Data.Error'.isError 'Data.Error'.fromOk 'Data.Error'.fromError)
