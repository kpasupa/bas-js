10 COMMON SC,TC,BACK
20 IF BACK=1 THEN GOSUB 300:BACK=0
30 SCREEN 0:CLS:COLOR 7,0
40 PRINT "===== Screen + Text colour  (CHAIN demo) ====="
50 PRINT
60 PRINT "Pick by CGA colour number (0-15):"
70 PRINT
80 PRINT "  0 black    4 red      8 grey      12 lt-red"
90 PRINT "  1 blue     5 magenta  9 lt-blue   13 pink"
100 PRINT "  2 green    6 brown   10 lt-green  14 yellow"
110 PRINT "  3 cyan     7 white   11 lt-cyan   15 br-white"
120 PRINT
130 PRINT "(pick two different colours so the text shows)"
140 PRINT
150 INPUT "Screen (background) colour, -1 = back";SC
160 IF SC<0 THEN CHAIN "GWBASIC/MENU"
170 INPUT "Text colour";TC
180 SCREEN 1:COLOR SC:PALETTE 3,TC:CLS
190 CHAIN "GWBASIC/COLOR/SHOW"
300 REM re-entered from SHOW WITHOUT a clear - screen is still in the picked colours
310 CLS
320 LOCATE 6,4:PRINT "Back in PICK by CHAIN - no clear."
330 LOCATE 8,4:PRINT "These colours survived the round trip."
340 LOCATE 11,4:PRINT "Press a key, then pick again..."
350 A$=INPUT$(1):RETURN
