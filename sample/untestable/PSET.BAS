10 REM PSET demo — plot a sine wave of coloured points
20 SCREEN 1:CLS
30 FOR I=0 TO 319
40 Y=100+80*SIN(I/18)
50 PSET (I,Y),(I/20) MOD 4
60 NEXT
70 REM STEP-relative points along the top
80 PSET (0,5)
90 FOR I=1 TO 30
100 PSET STEP(10,0),2
110 NEXT
120 A$=INPUT$(1)
130 CHAIN "LIST"
