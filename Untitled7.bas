Attribute VB_Name = "Module5"
' --- MAIN MACROS (Right-click your shapes and assign these) ---

Sub Toggle_POL_Act_Macro()
    ToggleColumns "AA:AF", "Hide Activity", "Activity"
End Sub

Sub Toggle_POL_Operation_Macro()
    ToggleColumns "AJ:AJ", "Hide Operational Issues", "Operational Issues"
End Sub

Sub Toggle_POL_ETA_Macro()
    ToggleColumns "AG:AI", "Hide ETA", "ETA vs Proforma"
End Sub

Sub Toggle_POL_Reefer_Macro()
    ToggleColumns "M:O", "Hide Reefer", "Reefer"
End Sub
Sub Toggle_Trade()
    ToggleColumns "AO:AT", "Hide Trade Breakdown", "Trade Breakdown"
End Sub

Sub Toggle_DG_Macro()
    ToggleColumns "AU:AU", "Hide DG", "DG Volume"
End Sub



' --- THE MASTER SHAPE ENGINE ---

Private Sub ToggleColumns(ColRange As String, ShownText As String, HiddenText As String)
    Dim xRange As Range
    Dim shp As Object
    
    ' Set the target columns
    Set xRange = ActiveSheet.Columns(ColRange)
    
    ' Identify which shape was clicked
    On Error Resume Next
    Set shp = ActiveSheet.Shapes(Application.Caller)
    On Error GoTo 0

    If Not shp Is Nothing Then
        ' Force solid fill to prevent "half-green" gradient glitches
        shp.Fill.Solid
        ' Keep text bold in both states
        shp.TextFrame.Characters.Font.Bold = True
        
        ' Toggle Logic: If columns are hidden, show them. Otherwise, hide them.
        If xRange.EntireColumn.Hidden = True Then
            ' STATE: SHOW COLUMNS
            xRange.EntireColumn.Hidden = False
            shp.TextFrame.Characters.Text = ShownText
            shp.Fill.ForeColor.RGB = RGB(146, 208, 80) ' Green
        Else
            ' STATE: HIDE COLUMNS
            xRange.EntireColumn.Hidden = True
            shp.TextFrame.Characters.Text = HiddenText
            shp.Fill.ForeColor.RGB = RGB(225, 225, 225) ' Grey
        End If
        
        ' Standardize Alignment
        shp.TextFrame.HorizontalAlignment = -4108 ' Center
        shp.TextFrame.VerticalAlignment = -4108   ' Center
    End If
    
    ActiveSheet.Range("S2").Select
End Sub
