10 REM WINDOW demo — logical coordinates (-1..1) instead of pixels
20 SCREEN 2:CLS
30 WINDOW (-1.2,-1.2)-(1.2,1.2)
40 REM axes
50 LINE (-1.2,0)-(1.2,0),1
60 LINE (0,-1.2)-(0,1.2),1
70 REM unit circle plotted point-by-point in logical space
80 FOR A=0 TO 6.3 STEP .02
90 PSET (SIN(A),COS(A)),1
100 NEXT
110 REM a diamond
120 LINE (-1,0)-(0,1),1
130 LINE (0,1)-(1,0),1
140 LINE (1,0)-(0,-1),1
150 LINE (0,-1)-(-1,0),1
160 A$=INPUT$(1)
170 CHAIN "LIST"
