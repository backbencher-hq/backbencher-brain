Class C
    Sub S(op As Ability)
        If op.Ability.Name.ToLower() <> "inner focus" Then
            Return
        End If
    End Sub
End Class
