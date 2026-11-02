Attribute VB_Name = "Module11"

Sub SetShapeVisibility(IsVisible As Boolean)
    Dim s As Shape
    For Each s In ActiveSheet.Shapes
        ' We don't want to hide the button we are clicking!
        ' This hides everything that starts above Row 12
        If s.Top < Range("A12").Top And s.Name <> Application.Caller Then
            s.Visible = IsVisible
        End If
    Next s
End Sub
