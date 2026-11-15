// CSHARP ONTOLOGY FIXTURE — a TUPLE-typed using alias, where the published module is a
// type expression unless it is deliberately made a NAME.
//
// `using FieldKey = (Type ContainerType, string FieldName);` declares a dependency on a
// TUPLE TYPE. A tuple type's identity is its element TYPES: `(Type ContainerType,
// string FieldName)` and `(Type, string)` are the SAME type, and `ContainerType` /
// `FieldName` are only labels this declaration gives the elements. Publishing the raw
// text therefore published two element NAMES that are not part of the type — in the one
// position where the lane's contract says the published value is a NAME ("a type
// EXPRESSION is not a module", the D3 rule that already strips a generic alias's type
// arguments and already strips element names from a tuple ARGUMENT).
//
// FOUND BY AN INDEPENDENT DERIVATION, not by a failing fixture: cs-ont-08 disagrees with
// the analyzer on exactly one row out of 2,185 imports over 800 aspnetcore `src` files,
// and that row was this one —
//
//     src/Components/Endpoints/src/Forms/ClientValidationCache.cs:17
//       analyzer published "(Type ContainerType,string FieldName)"
//
// The shapes below are the ones that decide it: the SAME tuple written with and without
// element names, a named tuple with a second element, and the controls — an ordinary
// namespace import, and a generic alias whose arguments are stripped off the module and
// published as separate `references` rows (D3) rather than welded into it.

using System;
using System.Collections.Generic;
using Plain = System.Text;
using Generic = System.Collections.Generic.Dictionary<string, Widget>;
using Named = (Type ContainerType, string FieldName);
using Unnamed = (Type, string);
using Nested = (int Count, System.Collections.Generic.List<string> Items);
using OneElement = (string Only);

namespace Acme.Tuple
{
    public class Widget { }
}