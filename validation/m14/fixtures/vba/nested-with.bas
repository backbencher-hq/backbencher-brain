Attribute VB_Name = "NestedWith"
Option Explicit

Public Sub OpenBooks()
    With Application
        .Run "Refresh"
        With Workbooks
            .Open "Book1.xlsx"
            .Run "Macro"
        End With
    End With
End Sub
