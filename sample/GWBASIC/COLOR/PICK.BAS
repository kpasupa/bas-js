10 COMMON SC,TC,BACK
20 IF BACK=1 THEN GOSUB 300:BACK=0
30 SCREEN 0:CLS:COLOR 7,0
35 LOCATE 1,27: COLOR 0,7: PRINT " GW-BASIC: Screen + Colour ": COLOR 7,0
36 LOCATE 2,1: PRINT STRING$(80,45)
40 LOCATE 4,5: PRINT "CGA colour numbers (0-15):"
50 LOCATE 6,5:  PRINT "  0 black     4 red       8 dark grey   12 lt-red"
60 LOCATE 7,5:  PRINT "  1 blue      5 magenta   9 lt-blue     13 pink"
70 LOCATE 8,5:  PRINT "  2 green     6 brown    10 lt-green    14 yellow"
80 LOCATE 9,5:  PRINT "  3 cyan      7 white    11 lt-cyan     15 br-white"
90 LOCATE 11,5: PRINT "(pick two different colours so the text is visible)"
100 LOCATE 12,1: PRINT STRING$(80,45)
110 LOCATE 14,5: INPUT "Screen (background) colour  (-1 to go back): ",SC
120 IF SC<0 THEN CHAIN "GWBASIC/MENU"
130 LOCATE 15,5: INPUT "Text colour: ",TC
140 SCREEN 1:COLOR SC:PALETTE 3,TC:CLS
150 CHAIN "GWBASIC/COLOR/SHOW"
300 REM re-entered from SHOW via CHAIN — still in picked colours, no clear
310 CLS
320 LOCATE 6,4:PRINT "Back in PICK by CHAIN — no clear."
330 LOCATE 8,4:PRINT "These colours survived the round trip."
340 LOCATE 11,4:PRINT "Press a key to pick again..."
350 A$=INPUT$(1):RETURN
