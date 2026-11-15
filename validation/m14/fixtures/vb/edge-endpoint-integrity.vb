' Four defects in the relationship graph this lane published, each of them a
' FABRICATED or UNNAVIGABLE ENDPOINT rather than a missing one, and each of them
' invisible to a per-type edge count because the count stayed healthy.
'
'   1. `New StackFrame(1).GetMethod().Name` published `instantiates -> GetMethod`.
'      The construction is COMPLETE and `.GetMethod` is a method call on the
'      object just built, but the analyzer's "is my parent a member access whose
'      object I am?" test said the construction was a namespace prefix, climbed
'      the chain and named the method. `GetMethod` is not a type anything
'      constructs. Measured on the lane corpus: 322 of the 15,543 construction
'      nodes sitting in an access chain were complete constructions whose target
'      was read off the wrong node, and an independent source-text oracle
'      (script/m14/vb-instantiates-oracle.ts, which reads NO grammar) put the
'      error at 1.07% of all `instantiates` edges before the fix and 0.00% after.
'
'   2. `Implements IEnumerable(Of CustomEvent).GetEnumerator` published the
'      target `IEnumerable(Of CustomEvent).GetEnumerator`. The type arguments are
'      not part of the name, so that string is not a name in the file, is not
'      navigable, and matches no symbol table. Measured: 94 of 286 `implements`
'      edges — the normal shape of a member-level interface implementation in
'      generic VB code.
'
'   3. `Function F(x As M) As (Range As ValueRange(Of Version), Name As String)`
'      published the `references` target
'      `(Range As ValueRange(Of Version), RecommendedComponent As String)` — a
'      PARAMETER LIST. `namingToken` had no case for `tuple_type`, so it returned
'      the node itself. Measured: 3 sites, which is small and is still a
'      fabricated endpoint.
'
'   4. The same relationship row was emitted more than once in one file: 6,590
'      rows over the corpus (references 3,813, instantiates 1,840, calls 935,
'      imports 2). `bb_impact` counts degrees, so three `As String` in one
'      signature made `String` look three times as depended-upon.
'
' Every shape below is real VB source taken from the corpus pattern that produced
' each defect. Nothing here is a synthetic form: a fixture that pins a shape the
' corpus never contains proves nothing about the corpus.
Imports System
Imports System.Collections.Generic

Public Class Endpoints

    ''' ── 1. a CONSTRUCTION whose receiver is read further along the chain ──────
    Public Function Trace() As String
        ''' `New StackFrame(1)` is the whole construction. `.GetMethod` is a call
        ''' ON the object just built and `.Name` is a property of that result, so
        ''' neither is a type. The three constructions are named; the two members
        ''' are NOT (forbidRelationships below).
        Dim a = New StackFrame(1).GetMethod().Name
        ''' The argument list is an `array_initializer`, not a `bounds` field, so a
        ''' `bounds`-only test would still climb here and publish `-> ToList`.
        Dim b = New String() {"x", "y"}.ToList()
        ''' The construction is the ARGUMENT of a call on another object: the
        ''' pre-fix code published `instantiates -> Add`.
        Dim c = Generic.List(Of String).Empty.Count
        ''' A NAMESPACE PREFIX really is a fragment: `New System.Text.StringBuilder`
        ''' holds only `New System` and the type continues in the chain. The climb
        ''' is required here and must survive the fix.
        Dim d = New System.Text.StringBuilder()
        Return a & b & c & d.ToString()
    End Function

    ''' ── 2. a member-level interface whose qualifier is a GENERIC name ─────────
    Public Function GetEnumerator() As IEnumerator Implements IEnumerable(Of String).GetEnumerator
        Return DirectCast(New List(Of String), IEnumerable(Of String)).GetEnumerator()
    End Function

    ''' ── 3. a TUPLE return type: SEVERAL types, one node ────────────────────────
    Public Function Requirements() As (Range As ValueRange, Name As String)
        Return Nothing
    End Function

    ''' ── 4. three references to ONE type on ONE line ───────────────────────────
    ''' `Public Sub F(a As String, b As String)` publishes three `As String`
    ''' reads at the same line, and the pre-fix analyzer published three
    ''' identical rows.
    Public Sub ThreeStrings(a As String, b As String) As String
        Dim c As String = a
        Dim d As String = b & c
    End Sub

    ''' Two constructions of ONE type on ONE line: two facts, one row after the
    ''' fix, with `duplicateRows: 2` so the raw count stays visible.
    Public Sub Twice()
        Dim x = New StackFrame(1).GetMethod().Name
        Dim y = New StackFrame(2).GetMethod().Name
    End Sub

End Class
