' vb/attributes-as-decorations — DECORATES, measured at the construct.
'
' Every declaration production in grammars/tree-sitter-vbnet carries
' `repeat(field("attributes", $.attribute_list))` (class, structure, interface, module, enum,
' enum_member, delegate, field, property, getter, setter, method, constructor, event, operator,
' the four interface member forms, parameter, declaration_statement). So an attribute is a
' DECLARATION's child and the edge's source is that declaration; the target is the attribute's
' LEAF name, because that is the key the arbiter resolves against the project's own declarations.
' The written spelling (`System.Serializable`) rides in metadata rather than in the target.
'
' THE FIELD IS THE CASE THAT NEEDS THE CLIMB: `_a` and `_b` are two declarators of ONE
' field_declaration, and the attribute list sits on the DECLARATION while this analyzer publishes
' a symbol per DECLARATOR. A reader that looks only at the declarator emits nothing for either.
Imports System

<Obsolete("use V2")>
Public Class Legacy
    <NonSerialized()>
    Private _a, _b As Integer

    <EditorBrowsable(EditorBrowsableState.Never)>
    Public Sub Hidden()
    End Sub

    <Obsolete>
    Public Property Tag As String
End Class

<System.Serializable()>
Public Class Store
    Public Sub Keep()
    End Sub
End Class

' THE QUALIFIED-GLOBAL CHAIN: the shape the restored DISMTools corpus measured at
' `Tools/BDELib/My Project/Settings.Designer.vb:31`. The argument is a five-link member-access
' chain whose last two links the analyzer used to publish as `uses` reads, because the
' attribute-position climb stopped at the first member access. The attribute NAME still
' decorates the declaration; the ARGUMENT is not a read (see the forbid rows).
<Global.System.ComponentModel.EditorBrowsableAttribute(Global.System.ComponentModel.EditorBrowsableState.Advanced)>
Public Class QualifiedChain
    Public Sub Keep()
    End Sub
End Class
