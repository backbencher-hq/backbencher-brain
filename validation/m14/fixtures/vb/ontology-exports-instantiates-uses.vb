Imports System.Collections.Generic
Imports System.Text

''' The three relationship types the Visual Basic lane had no verdict for at
''' handover. Each construct below is one the language HAS, so each is a GAP and
''' not a ruling, and each is measured on the lane corpus (2,658 tracked .vb
''' files across p3d, dismt, pcl, tankex and runtime) by
''' script/m14/vb-ontology-census.ts.

''' ── `exports`: VB expresses export through ACCESSIBILITY, not a keyword ──────
''' `exports_statement`, `export_list` and `assembly_attribute` are node types the
''' grammar HAS RULES for and that occur 0 times in 2,658 files, so a
''' keyword-shaped `exports` in VB would be an edge the language cannot express.
''' The construct is real and it is a CONVENTION: `Public`, plus the documented
''' per-context default for a declaration that writes none.

''' A modifier-less PROCEDURE defaults to Public, not Private. This is the row
''' that is easy to get wrong and VB is famous for disagreeing with C# on it:
''' fields and constants default to Private, procedures/properties/events default
''' to Public. The procedure below writes no modifier, so it is an export.
Public Class Api
    ''' Public, explicit.
    Public Sub Explicitly()
    End Sub

    ''' NO modifier, in a Class: default Public -> exported. A member declared
    ''' this way IS callable from another assembly.
    Sub ImplicitlyPublic()
    End Sub

    ''' NO modifier, in an Interface: default Public -> exported.
    Sub ImplicitlyPublicToo()
    End Sub

    ''' `Private`: not exported.
    Private Sub Hidden()
    End Sub

    ''' `Friend`: assembly-internal, NOT exported. A `Friend` type is visible to
    ''' a FRIEND ASSEMBLY, which is per-project configuration this analyzer never
    ''' sees, so the edge records the fact it can read and stops there.
    Friend Sub Assembly()
    End Sub

    ''' `Protected Friend`: the COMBINED modifier, and the case a single-string
    ''' accessibility cannot answer. It is "protected OR friend", so it IS
    ''' assembly-reachable -- through the friend half. This grammar puts
    ''' `Protected Friend` in ONE `member_modifier` node whose text is the two
    ''' words, so reading that node's text verbatim produced the single token
    ''' "protected friend", which matched no entry in the visibility order and fell
    ''' through to `internal`: 12 such declarations on the lane corpus, every one
    ''' of them published with the wrong accessibility.
    Protected Friend Sub BothHalves()
    End Sub

    ''' `Protected` alone: subclass-only, NOT assembly-exported. Paired with the
    ''' line above, this is the control that makes the `Protected Friend` row mean
    ''' something rather than "any modifier at all".
    Protected Sub HeirsOnly()
    End Sub

    ''' NO modifier, a FIELD: default Private -> not exported. The row the
    ''' procedure rows above are read against.
    Dim _implicitPrivate As Integer

    Public ReadOnly _publicField As Integer

    Friend _friendField As Integer

    ''' NO modifier, in a MODULE: default Public -> exported.
    Function InAModule() As Integer
        Return 1
    End Function

End Class

''' The one member kind whose default genuinely DIFFERS by container: a
''' modifier-less FIELD is Private in a Class and Private in a Module, and Public
''' in a Structure. The pair below is the only place the language's table makes the
''' container observable, so it is the row worth pinning.
Public Structure Coord
    ''' NO modifier, in a Structure: default Public -> exported.
    Dim X As Integer

    Private Dim _hidden As Integer
End Structure

Public Module Helpers
    ''' NO modifier, in a Module: default Public -> exported. A field in a Module
''' still defaults Private -- the module default is a PROCEDURE default.
    Function Go() As Integer
        Return 1
    End Function

    Dim _moduleField As Integer
End Module

''' A modifier-less top-level CLASS defaults to `Friend`, so it is not an export
''' of the assembly even though every member inside it may be Public. The edge is
''' recorded on the member and the containing type's own level rides on it as
''' `ownerAccessLevel`, because a `Friend` type is assembly-visible to a friend
''' assembly and this analyzer cannot see the friend-assembly list.
Friend Class InternalOnly
    Public Sub LooksPublic()
    End Sub
End Class

''' An interface's base list has NO keyword (`Interface I : IDisposable`) and
''' every entry is an interface the type IMPLEMENTS -- VB has no interface
''' inheritance. Labelling it `extends` was the mislabelled-header-clause defect:
''' a single `seenInherits` flag initialised to -1 and never assigned made every
''' name after the colon an `extends` target, so a class that IMPLEMENTS an
''' interface was published in `bb_graph` as INHERITING it.
Public Interface ISized : IDisposable, IComparable
    Sub Reset()
End Interface

''' The other half of the same clause, and the control: `Class C : Inherits B` is
''' an `extends`, decided by reading the `Inherits` keyword out of the source span
''' between the `:` and the first name -- the grammar inlines the keyword away, so
''' the node types alone cannot tell the two forms apart.
Public Class Derived : Inherits Api
    Public Sub AlsoFine()
    End Sub
End Class

''' ── `instantiates`: four VB construction surfaces, four shapes ───────────────
Public Class Builds
    ''' A field with `As New T()`: the fourth surface, and the only one whose
    ''' `New` keyword the grammar inlines away ENTIRELY -- measured at 0 of 30,001
    ''' `as_clause` nodes carrying an `As` or `New` token. `As New
    ''' Timers.Timer()` puts an `array_type` in `declared_type` because the `()`
    ''' reads as bounds, so the name is the element type.
    Private _timer As New Timers.Timer()

    ''' A generic `As New`.
    Private _list As New List(Of String)

    ''' `New Foo()` with an EMPTY argument list: `object_creation_expression`.
    Public Sub EmptyArgs()
        Dim a = New Widget()
    End Sub

    ''' `New Foo(1, 2)` with arguments: `array_creation_expression` with a `type`
    ''' field and a `bounds` field and NO `function` field. Keying on
    ''' `invocation_expression` alone dropped every one of these -- 15,181 of them
    ''' on the lane corpus.
    Public Sub WithArgs()
        Dim a = New Widget(1, 2)
    End Sub

    ''' `New System.Drawing.Size(3, 4)` does NOT parse as one construction. It
    ''' parses as an `array_access_expression` whose `array` is a
    ''' `member_access_expression` whose innermost `object` is an
    ''' `object_creation_expression` holding ONLY `New System`. Publishing that
    ''' node's own `type` field would publish `instantiates -> System`, a
    ''' namespace nobody constructs: the grammar's fragmentation turned into a
    ''' fact about the program. The target is the LAST leaf of the access chain.
    Public Sub Qualified()
        Dim size = New System.Drawing.Size(3, 4)
    End Sub

    ''' A construction inside a local declaration, so the enclosing declaration
    ''' is the method -- the source attribution for every construction here.
    Public Function Make() As Widget
        Return New Widget(7)
    End Function
End Class

''' ── `uses`: a qualified NAME READ, the commonest expression in VB ───────────
''' Measured on the lane corpus: 323,540 `member_access_expression` and 1,017
''' `with_member_access_expression` nodes are a read rather than a callee or an
''' index, in 1,921 of 2,658 files. `uses` is emitted for the read positions only:
''' a name that is being CALLED is a `calls` edge naming the same name, and
''' publishing both labels for one name would make the two classes
''' indistinguishable.
Public Class Reads
    Private _name As String

    ''' `Me._name` is a READ of the member `_name`, so `uses Reads -> _name`.
    ''' The receiver (`Me`) names nothing and is not a target.
    Public Sub QualifiedRead()
        Me._name = "x"
    End Sub

    ''' `StringBuilder.Append(...)`: the READ of `Append` is the RECEIVER of the
    ''' call, and `StringBuilder` is a type name the file does not declare -- it
    ''' is a `references` candidate, not a `uses` target. Only `Append` is read
    ''' here, and the callee slot is excluded from `uses` so the name is not
    ''' published twice under two labels.
    Public Sub CalleeIsNotARead()
        Dim sb As New System.Text.StringBuilder()
        sb.Append("x")
    End Sub

    ''' `Me.GetLength()` is the INVOCATION of the member, which the grammar keeps
    ''' in an `invocation_expression` whose `function` is the
    ''' `member_access_expression` -- the callee slot, so this is a `calls` edge
    ''' and NOT a `uses` edge.
    Public Function Invoked() As Integer
        Return Me.GetHashCode()
    End Function

    ''' A NAMESPACE read: `New System.Text.StringBuilder()` is one access chain, and
    ''' every segment of it is a name the file reads. `Text` is a namespace segment
    ''' rather than a member, and the graph cannot tell a namespace segment from a
    ''' member of the same name -- so the edge is the name READ, and `readNode`
    ''' records which grammar node produced it. The construction itself is ONE
    ''' `instantiates` edge to `StringBuilder`, not one per segment: the `New` head
    ''' is the leading segment of the chain and the type is its last leaf.
    Public Sub DottedPath()
        Dim sb As New System.Text.StringBuilder()
    End Sub

    ''' The same dotted read in EXPRESSION position. `System.Text.Encoding.UTF8` is
    ''' a three-segment access chain with nothing invoked on the end of it, so
    ''' all THREE segments are reads and `uses` names `Text`, `Encoding` and
    ''' `UTF8`. `Text` is a namespace segment and `UTF8` is a static property, and
    ''' the tree cannot tell them apart -- which is why the edge is labelled `uses`
    ''' (a read of a name) and carries no claim about what kind of member it is.
    ''' The callee-slot exclusion is what keeps the two classes disjoint; see
    ''' `CalleeIsNotARead` and `Invoked` for the excluded half.
    Public Function Utf8() As Object
        Return System.Text.Encoding.UTF8
    End Function
End Class
