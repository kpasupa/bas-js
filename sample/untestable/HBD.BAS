10 REM HBD demo — Happy Birthday, with balanced > / < so the last note stays high
20 SCREEN 0:CLS
30 PRINT "Happy Birthday"
40 PRINT
50 PRINT "Playing..."
60 PLAY "T120 O4 L8 G G L4 A G > C < B2"
70 PLAY "L8 G G L4 A G > D C2 <"
80 PLAY "L8 G G L4 > G E C < B A"
90 PLAY "L8 > F F L4 E C D C2"
100 PRINT:PRINT "Done. Press a key..."
110 A$=INPUT$(1)
120 CHAIN "LIST"
