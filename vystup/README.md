# Česká denní sada 2026-10-05

60 různých každodenních cílových slov od **5. října do 3. prosince 2026**, včetně obou dnů. Jeden nový cíl za den, přepnutí o půlnoci v Europe/Prague. Po skončení sady se stávající herní logika vrací na začátek harmonogramu.

Každý den má stejný slovník základních tvarů. Pořadí je souvislé od 1 do velikosti slovníku; 1 má pouze tajné slovo. Skloňování a časování se přijímá přes `aliases.json`, ale nezabírá samostatná místa a zobrazuje se jako základní tvar. Tipy bez diakritiky mají také podporu. U víceznačných tvarů má přednost přesný základní tvar, jinak frekventovanější slovníková interpretace. Přijetí cizího řetězce písmen se nepředstírá náhodným pořadím.

## Jak vzniklo pořadí

České 300rozměrné vektory fastText z Wikipedie, prvních 400 000 tokenů v pořadí četnosti, byly analyzovány slovníkem MorfFlex CZ 161115. Vlastní jména a nerozpoznané tokeny byly vyřazeny. Základní tvary slučují vektory svých tvarů s váhou podle české četnosti wordfreq; základní tvar dostává trojnásobnou váhu. Slovník zachovává slova s maximální Zipf četností základního tvaru nebo pozorovaného tvaru alespoň 2,2. Obsahuje také běžné pozdravy, zájmena a další slovní druhy.

Pro každý cíl bylo vybráno 8–10 významově blízkých běžných asociací. Ty tvoří ručně zkontrolovaný začátek žebříčku a upřesňují zvolený význam, například kolo jako bicykl. Zbytek se řadí podle kosinové podobnosti k vektoru složenému ze 40 % cílového vektoru a 60 % průměru asociací. Mírná penalizace vzácných slov a shodného začátku omezuje odborné a čistě slovotvorné sousedy. U osmi cílů bylo ručně upraveno okolí pořadí 150: nevhodné slovo z korpusu bylo prohozeno s tematickým slovem v původním pásmu 100–250, aby radar dával použitelnou nápovědu. Přesný vzorec, tyto úpravy a velikosti jsou v `manifest.json`.

Je to kombinace jazykového modelu a ruční kontroly nejbližšího okolí, nikoli slovník bezchybně objektivních významových vzdáleností. Méně běžná slova mimo omezený vektorový slovník mohou být odmítnuta. Nová sada nerecykluje staré CSV žebříčky.

## Soubory

- `harmonogram.csv`: pořadí 60 denních cílů.
- `den_*.csv`: kompletní žebříček základních tvarů pro jednotlivý den.
- `aliases.json`: přijímané gramatické tvary a jejich základní tvar.
- `review.json`: data, prvních 20 slov a slovo na pořadí 150 pro kontrolu každého dne; obsahuje řešení.
- `manifest.json`: rozsah, metodika a SHA-256 kontrolní součty dat.

Generování i stažené modely byly v dočasném `.venv-semantic`. Herní server používá jen výsledné CSV/JSON a Python nepotřebuje. Starý uložený stav a rekapitulace byly odstraněny; kontrola verze sady navíc brání obnovení starých tipů při nasazení.

## Zdroje a atribuce

- [fastText Wiki word vectors](https://fasttext.cc/docs/en/pretrained-vectors.html), Piotr Bojanowski, Edouard Grave, Armand Joulin a Tomas Mikolov: *Enriching Word Vectors with Subword Information*, TACL 2017. Vektory jsou poskytovány pod CC BY-SA 3.0.
- [Czech Models MorfFlex CZ 161115 + PDT 3.0](https://hdl.handle.net/11234/1-1836), ÚFAL, Jan Hajič a Jaroslava Hlaváčová; MorphoDiTa Milan Straka a Jana Straková. Model je poskytován pod CC BY-NC-SA 4.0 (nekomerční podmínka). Atribuce a podmínky původních dat se vztahují i na použití odvozených slovníkových dat podle příslušných licencí.
- [wordfreq](https://github.com/rspeer/wordfreq), Robyn Speer, verze 3.1.1; software Apache 2.0 a frekvenční data CC BY-SA 4.0.
