Attribute VB_Name = "Module3"

Sub See_BSA()
'
' See_Activity Macro
'

'
    
    
    Application.ScreenUpdating = False

If ActiveSheet.Shapes("TextBox 7").TextFrame.Characters.Text = "Booking Flash Report NA" Then
    ActiveSheet.Shapes("TextBox 7").TextFrame.Characters.Text = "Hide BSA & BKG Weight"
    ActiveSheet.Shapes("TextBox 7").Select
    Selection.Font.ColorIndex = 3
    
    
        'Hide Rows


    Columns("Q:R").Select
    Selection.EntireColumn.Hidden = False

    Range("A1").Select
    
Else
    ActiveSheet.Shapes("TextBox 7").TextFrame.Characters.Text = "Booking Flash Report NA"
   
    
    ActiveSheet.Shapes("TextBox 7").Select
    Selection.Font.ColorIndex = 1
    
    
    
        'Unhide Rows
    

    Columns("Q:R").Select
    Selection.EntireColumn.Hidden = True
    
    Range("A1").Select
    
End If

Application.ScreenUpdating = True
    
        
    
    
End Sub

