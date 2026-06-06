10 REM POINT demo — draw, read a pixel's colour, report it in text mode
20 SCREEN 1:CLS
30 LINE (0,0)-(319,199),2
40 CIRCLE (160,100),60,3
50 PAINT (160,100),1,3
60 C1=POINT(160,100)
70 C2=POINT(5,3)
80 C3=POINT(310,196)
90 SCREEN 0:CLS
100 PRINT "POINT results:"
110 PRINT "  centre of filled circle =";C1
120 PRINT "  on the diagonal line    =";C2
130 PRINT "  background corner        =";C3
140 PRINT:PRINT "Press a key..."
150 A$=INPUT$(1)
160 CHAIN "LIST"
