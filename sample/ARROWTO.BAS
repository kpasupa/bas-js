10 SCREEN 0: WIDTH 40: CLS
20 DIM M$(4)
30 M$(1) = "Start Game"
40 M$(2) = "Load Game"
50 M$(3) = "Options"
60 M$(4) = "Quit"
70 CURR = 1

' --- Print Menu Loop ---
80 LOCATE 1,1
90 COLOR 15, 0: PRINT "--- MAIN MENU ---"  ' Bright white title
100 PRINT
110 FOR I = 1 TO 4
120   LOCATE 3 + I, 5                      ' Move cursor to each line
130   IF I = CURR THEN COLOR 0, 7 ELSE COLOR 7, 0  ' Highlight vs Normal
140   PRINT M$(I); "   "                   ' Extra spaces clear old characters
150 NEXT I

' --- Wait for Key Press ---
160 K$ = INKEY$: IF K$ = "" THEN 160

' --- Handle Enter Key ---
170 IF K$ = CHR$(13) THEN GOTO 260

' --- Handle Arrow Keys ---
180 IF LEN(K$) = 2 THEN A$ = RIGHT$(K$, 1) ELSE GOTO 240
190 IF A$ = CHR$(72) THEN CURR = CURR - 1  ' Up Arrow
200 IF A$ = CHR$(80) THEN CURR = CURR + 1  ' Down Arrow

' --- Boundary Checks ---
210 IF CURR < 1 THEN CURR = 4
220 IF CURR > 4 THEN CURR = 1

240 GOTO 80

' --- Selection Confirmed ---
260 COLOR 7, 0: CLS                       ' Reset colors to normal
270 PRINT "You selected: "; M$(CURR)
280 END