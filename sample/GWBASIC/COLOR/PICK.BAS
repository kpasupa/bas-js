10 COMMON SC,TC,BACK
20 IF BACK=1 THEN GOSUB 300:BACK=0
30 SCREEN 0:CLS:COLOR 7,0
35 LOCATE 1,26: COLOR 0,7: PRINT " GW-BASIC: Text Colour Demo ": COLOR 7,0
36 LOCATE 2,1: PRINT STRING$(80,45)
40 LOCATE 4,5: PRINT "Text colour  (0-15):"
50 LOCATE 5,5:  PRINT "   0 black     4 red       8 dark grey   12 lt-red"
60 LOCATE 6,5:  PRINT "   1 blue      5 magenta   9 lt-blue     13 pink"
70 LOCATE 7,5:  PRINT "   2 green     6 brown    10 lt-green    14 yellow"
80 LOCATE 8,5:  PRINT "   3 cyan      7 white    11 lt-cyan     15 br-white"
90 LOCATE 10,5: PRINT "Background   (0-7, text mode):"
100 LOCATE 11,5: PRINT "   0 black  1 blue  2 green  3 cyan"
110 LOCATE 12,5: PRINT "   4 red    5 magenta       6 brown  7 white"
120 LOCATE 14,1: PRINT STRING$(80,45)
130 LOCATE 16,5: INPUT "Text colour  (-1 to go back): ",TC
140 IF TC<0 THEN CHAIN "GWBASIC/MENU"
150 LOCATE 17,5: INPUT "Background (0-7): ",SC
155 IF TC MOD 16 = SC THEN COLOR 7,0:LOCATE 19,5:PRINT "Same colour — invisible. Pick again.":GOTO 130
160 COLOR TC,SC: CLS
170 CHAIN "GWBASIC/COLOR/SHOW"
300 REM re-entered from SHOW via CHAIN - colours still active, no clear yet
310 CLS
320 LOCATE 6,10: PRINT "Back in PICK by CHAIN."
330 LOCATE 8,10: PRINT "Text colour"; TC; "on background"; SC; "survived the round trip."
340 LOCATE 10,10: PRINT "Press a key to pick again..."
350 A$=INPUT$(1): RETURN
