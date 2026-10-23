# Hotová denní data

30 dnů od 2026-10-23 do 2026-11-21, pásmo Europe/Prague.

- `lexicon.json`: 219 607 základních položek; ID odpovídá pozici v poli.
- `den_01.ranks.bin` až `den_30.ranks.bin`: jedinečné pořadí každého ID pro daný den.
- `forms.pages.json` a `forms.pages.001.bin` atd.: 5 386 783 přesných zápisů a tvarů, komprimované stránky v částech do 6 000 000 bajtů.
- `accentless.pages.json` a `accentless.pages.001.bin` atd.: pevný výklad zápisů bez diakritiky, stejně rozdělený do menších souborů.
- `input-aliases.json`: kontrolované přednosti pro kolidující bezdiakritické zápisy.
- `harmonogram.csv`, `words.json`: cíle, rody, kategorie a kontrolované nápovědy.
- `manifest.json`: verze, metodika, počty a SHA-256 kontrolní součty.
- `review.json`: řešení a nejbližší slova — pozor, spoilery.

Data už jsou připravená. Patří k nim nové `src/wordService.js` a `src/semanticIndex.js`. Server potřebuje jen Node; Python a modely jsou potřeba pouze pro další výrobu dat. Podrobnosti a licence jsou v hlavním README.
