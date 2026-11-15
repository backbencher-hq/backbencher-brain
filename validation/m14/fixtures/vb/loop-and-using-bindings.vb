' M14.0.F1 vb repayment (2026-10-08).
'
' The statement-level index and the loop/using BINDER. This grammar gives an
' argument-bearing call and an array index the SAME node type
' (`array_access_expression`), so a bare `item(0)` in statement position is
' published as `calls -> item` unless the name is known to be a local. The
' For Each and Using branches that record those locals read a field the pinned
' grammar does not have, so they never fired and the lane published three
' fabricated call edges on this shape.
'
' Every row below is real VB that parses clean; nothing here is synthetic in the
' sense that matters (a shape the corpus never contains).
Imports System

Module LoopAndUsingBindings
  Sub Run()
    Dim xs(3) As Integer
    Dim d(3) As Integer

    For Each item In xs
      item(0)
    Next

    For Each kv As KeyValuePair(Of String, Integer) In pairs
      kv(0)
    Next

    Using g As New Graphics()
      g(0)
    End Using

    ' CONTROL: a `Dim` local. This branch was never broken, so the row must not
    ' move — it is what tells a repair of the other two apart from a blanket
    ' suppression of the statement-level signal.
    d(0)

    ' CONTROL: real calls, including a qualified one. A fix that narrowed the
    ' signal too far would take these with it.
    Helper()
    Me.Touch()
  End Sub

  ReadOnly Property Pairs As KeyValuePair(Of String, Integer)()
    Get
      Return Nothing
    End Get
  End Property

  Sub Helper()
  End Sub

  Sub Touch()
  End Sub
End Module
