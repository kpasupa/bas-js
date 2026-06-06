10 SCREEN 0:CLS:COLOR 7,0
20 PRINT "===== Screen + Text colour  (CHAIN demo) ====="
30 PRINT
40 PRINT "Pick by CGA colour number (0-15):"
50 PRINT
60 PRINT "  0 black    4 red      8 grey      12 lt-red"
70 PRINT "  1 blue     5 magenta  9 lt-blue   13 pink"
80 PRINT "  2 green    6 brown   10 lt-green  14 yellow"
90 PRINT "  3 cyan     7 white   11 lt-cyan   15 br-white"
100 PRINT
110 PRINT "(pick two different colours so the text shows)"
120 PRINT
130 INPUT "Screen (background) colour, -1 = back";SC
140 IF SC<0 THEN CHAIN "GWBASIC/MENU"
150 INPUT "Text colour";TC
160 COMMON SC,TC
170 SCREEN 1:COLOR SC:PALETTE 3,TC:CLS
180 CHAIN "GWBASIC/COLOR/SHOW"
