Attribute VB_Name = "Module4"
' --- MAIN MACROS (Assign these to your shapes) ---

Sub ToggleBsa_Macro():      ToggleColumns "S:T", "Hide BSA", "BSA": End Sub
Sub ToggleActive_Macro():   ToggleColumns "Z:AG", "Hide Activity", "Activity": End Sub
Sub ToggleStatus_Macro():   ToggleColumns "AM:AM", "Hide AP Status", "AP Status": End Sub
Sub ToggleRotation_Macro(): ToggleColumns "AK:AL", "Hide Rotation", "Rotation": End Sub
Sub ToggleVoy_Macro():      ToggleColumns "AN:AN", "Hide Voyage Remarks", "Voyage Remarks": End Sub
Sub ToggleOps_Macro():      ToggleColumns "AH:AH", "Hide Operational Issues", "Operational Issues": End Sub
Sub ToggleSector_Macro():   ToggleColumns "AI:AJ", "Hide Sector Allocation", "Sector Allocation": End Sub
Sub ToggleRfr_Macro():      ToggleColumns "U:Y", "Hide Reefer", "Reefer": End Sub
Sub ToggleTrade_Macro():    ToggleColumns "AO:AT", "Hide Trade Breakdown", "Trade Breakdown": End Sub
Sub ToggleDG_Macro():       ToggleColumns "AU:AU", "Hide DG", "DG Volume": End Sub
Sub ToggleVco_Macro():      ToggleColumns "AK:AK", "Hide VCO", "VCO Analyst": End Sub




' --- THE "ALWAYS BOLD" ENGINE ---

Private Sub ToggleColumns(ColRange As String, ShownText As String, HiddenText As String)
    Dim xRange As Range
    Dim shp As Object
    
    Set xRange = ActiveSheet.Columns(ColRange)
    
    On Error Resume Next
    Set shp = ActiveSheet.Shapes(Application.Caller)
    On Error GoTo 0

    If Not shp Is Nothing Then
        ' Force the shape to a solid fill to clear any "half-green" gradients
        shp.Fill.Solid
        
        ' Apply Bold to the font for BOTH states
        shp.TextFrame.Characters.Font.Bold = True
        
        If xRange.EntireColumn.Hidden = True Then
            ' --- STATE: SHOWING COLUMNS (Vibrant Green) ---
            xRange.EntireColumn.Hidden = False
            shp.TextFrame.Characters.Text = ShownText
            shp.Fill.ForeColor.RGB = RGB(146, 208, 80) ' Bright Green
        Else
            ' --- STATE: HIDING COLUMNS (Clean Grey) ---
            xRange.EntireColumn.Hidden = True
            shp.TextFrame.Characters.Text = HiddenText
            shp.Fill.ForeColor.RGB = RGB(225, 225, 225) ' Light Grey
        End If
        
        ' Ensure text is always centered vertically and horizontally
        shp.TextFrame.HorizontalAlignment = -4108 ' xlCenter
        shp.TextFrame.VerticalAlignment = -4108   ' xlCenter
    End If
    
    ' Select a safe cell so the shape doesn't stay "focused"
    ActiveSheet.Range("A12").Select
End Sub
