10 SCREEN 0:CLS
20 PRINT "===== bas-js  graphics / sound demos ====="
30 PRINT
40 PRINT " 1  PSET     points (sine wave)"
50 PRINT " 2  LINE     lines + boxes"
60 PRINT " 3  CIRCLE   circles / ellipse / arc"
70 PRINT " 4  PAINT    flood fill"
80 PRINT " 5  DRAW     macro shapes"
90 PRINT " 6  PALETTE  palette cycling"
100 PRINT " 7  GETPUT   sprite blit"
110 PRINT " 8  POINT    read a pixel"
120 PRINT " 9  WINDOW   logical coordinates"
130 PRINT "10  SOUND    rising tones"
140 PRINT "11  PLAY     a tune"
145 PRINT "12  HBD      Happy Birthday"
150 PRINT
160 INPUT "Pick a number (0=quit)";N
170 IF N=0 THEN CLS:END
180 IF N=1 THEN CHAIN "PSET"
190 IF N=2 THEN CHAIN "LINE"
200 IF N=3 THEN CHAIN "CIRCLE"
210 IF N=4 THEN CHAIN "PAINT"
220 IF N=5 THEN CHAIN "DRAW"
230 IF N=6 THEN CHAIN "PALETTE"
240 IF N=7 THEN CHAIN "GETPUT"
250 IF N=8 THEN CHAIN "POINT"
260 IF N=9 THEN CHAIN "WINDOW"
270 IF N=10 THEN CHAIN "SOUND"
280 IF N=11 THEN CHAIN "PLAY"
285 IF N=12 THEN CHAIN "HBD"
290 GOTO 10
