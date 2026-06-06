10 REM SOUND demo — sweep frequencies (freq Hz, duration in 18.2/sec ticks)
20 SCREEN 0:CLS
30 PRINT "SOUND demo"
40 PRINT
50 PRINT "Rising sweep..."
60 FOR F=200 TO 2000 STEP 120
70 SOUND F,2
80 NEXT
90 PRINT "Falling sweep..."
100 FOR F=2000 TO 200 STEP -120
110 SOUND F,2
120 NEXT
130 PRINT:PRINT "Done. Press a key..."
140 A$=INPUT$(1)
150 CHAIN "LIST"
