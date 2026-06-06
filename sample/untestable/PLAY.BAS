10 REM PLAY demo — MML music strings (tempo, octave, length, notes, rests)
20 SCREEN 0:CLS
30 PRINT "PLAY demo"
40 PRINT
50 PRINT "Scale up..."
60 PLAY "T140 O4 L8 CDEFGAB O5 C"
70 PRINT "Scale down..."
80 PLAY "O5 L8 C O4 BAGFEDC"
90 PRINT "A little tune..."
100 PLAY "T120 O4 L4 G G A G O5 C O4 B2"
110 PLAY "L4 G G A G O5 D O4 C2"
120 PRINT:PRINT "Done. Press a key..."
130 A$=INPUT$(1)
140 CHAIN "LIST"
