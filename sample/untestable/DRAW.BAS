10 REM DRAW demo — shapes from a macro string
20 SCREEN 1:CLS
30 REM a square in colour 2
40 PSET (60,60)
50 DRAW "C2 R60 D60 L60 U60"
60 REM a diamond in colour 3 (diagonals)
70 PSET (200,40)
80 DRAW "C3 F30 G30 H30 E30"
90 REM B = move without drawing, then a small box
100 PSET (60,150)
110 DRAW "C1 BR20 R40 D30 L40 U30"
120 A$=INPUT$(1)
130 CHAIN "LIST"
