# WordGame — hotová 30denní sada

Tento ZIP obsahuje celý původní projekt s již nahrazenými herními daty a upraveným načítáním velkého slovníku. Není to pouze doplňkový balíček.

- **30 cílových slov**, od **23. října do 21. listopadu 2026**, přepnutí o české půlnoci.
- **219 607 základních položek** ve společném slovníku pro každý den.
- **5 386 783 přesně zapsaných slov a gramatických tvarů**, navíc podpora zápisu bez diakritiky.
- Každý den má vlastní kompletní pořadí **1–219 607**. Jednička je řešení, všechny ostatní pozice jsou vypočítané. Gramatické tvary sdílejí pořadí svého základního slova.

## Spuštění

Ve složce projektu spusť obvyklým způsobem:

```bash
npm ci
npm start
```

Pro použití hotové hry **nepotřebuješ Python, velké jazykové modely ani placené AI API**. Nastavení aplikace a případného hostingu zůstává podle `.env.example` a `OPERATIONS.md`.

Pokud už máš živou kopii s novějšími vlastními změnami, přenes při zastaveném serveru celou složku `vystup`, soubory `src/wordService.js`, `src/semanticIndex.js` a `src/data/words.json`; pak server restartuj. Samotná výměna dat bez nového načítacího modulu nestačí.

Nová verze sady zabrání obnovení rozehraných her se starým řešením a pořadím. Hráčské profily a účty tento balíček nemaže. Kopie původních uložených souborů z přiloženého projektu zůstaly zachované. Po uplynutí 30 dní se původní herní logika vrací na začátek sady.

## Výpočet významové blízkosti

Výpočet proběhl offline v Pythonu. Používá **celý český fastText Common Crawl model se 2 000 000 položkami** a **celý český Wikipedie model s 627 841 položkami**. Jejich podobnosti se kombinují; žádnému chybějícímu tipu se nepřiděluje náhodné pořadí.

Gramatické tvary zpracovává **MorfFlex CZ 2.1 / MorphoDiTa**, včetně generování skutečných slovníkových paradigmat. U slov rozpoznaných morfologickým slovníkem nebyla uplatněna předchozí přísná frekvenční hranice. Zachovávají se i vzácné platné výrazy, vlastní názvy a běžné korpusové výpůjčky. Neznámé výpůjčky musí být přímo doložené ve wordfreq nebo ručně ověřené; nestačí odhad četnosti složený z kousků URL.

Vektor základního slova kombinuje přímé zastoupení slova s průměrem jeho pozorovaných tvarů. Pokud jedno vydání vektor neobsahuje, odhaduje se ze druhého pomocí zarovnání naučeného na společných slovech. Víceznačné cíle mají určený význam, například kolo jako bicykl a lednice jako spotřebič.

Dotaz kombinuje cíl s tematickými vodítky. Výsledné skóre je 65 % podobnosti z Common Crawl a 35 % z Wikipedie, s malým zohledněním vzácnosti a jistoty slovníkového rozpoznání. Úplná metodika je ve `vystup/manifest.json`. Vodítka nemají ručně přikázané pozice; kromě řešení na místě 1 je pořadí dopočítané.

Čtyři novější výrazy, které ve výchozím prostoru chyběly — **covid, covidový, chatbot a chatgpt** — mají samostatné vektory odvozené z ručně ověřeného popisu významu. Jsou označené v metadatech a v `tools/semantic/supplements.json`; nejde o předstírání původních natrénovaných vektorů. Stejným postupem lze řešit další objevené mezery.

Skloňování a zápisy bez diakritiky mají pevné výklady. Například `králíky` odkazuje na králíka a `psi` na psa. Zápisy `kava`, `skola`, `reka`, `chleb`, `dest` a `more` fungují pro příslušná běžná česká slova. Skutečná základní slova jako `byt` a `být` se zachovávají odděleně.

Slovník je rozsáhlý, ale konečný. Novotvar, překlep nebo nedoložený výraz může stále odmítnout; neexistuje záruka přijetí každého možného českého slova. Korpusové vektory také mohou dát občas zvláštní asociaci. Vstup zůstává jednoslovný, nejméně dvě písmena, s podporou vnitřního spojovníku.

## Proč jsou data nyní binární

Původní denní CSV nahrazují předpočítaná pole pořadí a společné slovníkové indexy. Pět milionů tvarů se nenačítá jako pět milionů JavaScriptových objektů. Slovník je rozdělený do komprimovaných stránek s omezenou cache; jednotlivý tip jen vyhledá uložené číslo. Při hraní se nespouští jazykový model.

Komprimované stránky jsou uložené v částech `forms.pages.001.bin` a `accentless.pages.001.bin` atd., každá nejvýše 6 000 000 bajtů. Lze je nahrávat přes web GitHubu. Načítací modul otevírá jednotlivé části přímo; při startu nespojuje celý slovník do paměti. Rozdělení nemění slovní zásobu ani pořadí slov.

Čitelný export jednoho dne vytvoří standardní Python bez dalších balíčků:

```bash
python3 tools/semantic/export_day.py --day 1 --output den_01.csv
```

`vystup/review.json` obsahuje řešení, prvních 50 sousedů a kontrolované nápovědy každého dne. Obsahuje spoilery.

## Ověření

Celá aplikace prošla **58 automatickými testy**, včetně multiplayeru, restartů, ukládání, nápověd, širokého slovníku a všech 30 odpovědí bez diakritiky. Kontrola rozdělených souborů pokrývá první a poslední stránku každé části.

Kontrola všech denních tabulek ověřila jednotný slovník, každé pořadí právě jednou, správné řešení, všechny stránky obou indexů a kontrolní součty. Samostatně se kontrolovalo 363 ručně vybraných běžných slov a tvarů a 49 741 častých zápisů z wordfreq. Zjištěná mezera covid/covidu byla při vývoji doplněna; výsledky jsou v `tools/semantic/coverage-check.json`. Tento soupis není nezávislým testem všech českých slov ani důkazem bezchybné sémantiky.

V lokálním měření vycházelo vyhodnocení tipů v řádu zlomků milisekundy a paměť procesu kolem 180 MiB. Podmínky a přesná čísla jsou v reportu; výkon závisí na hostingu.

## Další generování

Hotová data už jsou v projektu. Následující postup potřebuješ pouze pro vlastní přegenerování:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r tools/semantic/requirements.txt
.venv/bin/python tools/semantic/rebuild.py --start-date 2026-10-23
```

Na Windows použij `.venv\Scripts\python.exe`. První běh stáhne zdrojové modely a potřebuje několik GB volného místa; soubory pro přípravu se ukládají do `.semantic-build`. Velké modely nejsou potřeba pro provoz hry a nejsou v ZIPu.

Cíle a tematická vodítka jsou v `tools/semantic/targets.tsv`, upřesnění významu v `senses.tsv`, kontrolované nápovědy v `radar.tsv`. Současný generátor očekává 30 různých cílů. Každý cíl musí mít dostupný vektor a nápovědu se skutečným pořadím 50–1500. Při změně cílů kontroluj i `review.json`; výběr kvalitních nápověd není automaticky zaručený.

Po změně slovníku nebo definic nových výrazů přidej `--rebuild-vocabulary`; znovu se sestaví základní prostor i doplňky. Zdrojové skripty, pevné verze knihoven a seznam použitých zdrojů jsou přiložené. Přegenerování prováděj při zastaveném serveru.

## Zdroje a licence

- [fastText Word vectors for 157 languages](https://fasttext.cc/docs/en/crawl-vectors.html): Edouard Grave, Piotr Bojanowski, Prakhar Gupta, Armand Joulin a Tomas Mikolov, *Learning Word Vectors for 157 Languages*, LREC 2018. Český Common Crawl model; CC BY-SA 3.0.
- [fastText Wiki word vectors](https://fasttext.cc/docs/en/pretrained-vectors.html): Piotr Bojanowski, Edouard Grave, Armand Joulin a Tomas Mikolov, *Enriching Word Vectors with Subword Information*, TACL 2017. České wiki vektory; CC BY-SA 3.0.
- [Czech MorfFlex2.1 + PDT-C 2.0, modely 250909](https://hdl.handle.net/11234/1-5985), ÚFAL / Univerzita Karlova; MorfFlex Jan Hajič, Jaroslava Hlaváčová, Marie Mikulová, Milan Straka a Barbora Štěpánková; MorphoDiTa Milan Straka a Jana Straková. Data modelu CC BY-NC-SA 4.0; úplný text licence je v `tools/semantic/licenses`.
- [wordfreq](https://github.com/rspeer/wordfreq), Robyn Speer, 3.1.1. Software Apache 2.0; frekvenční data CC BY-SA 4.0.

Odvozená jazyková data byla upravena výběrem, normalizací, sloučením tvarů, zarovnáním prostorů a výpočtem pořadí. Respektují podmínky příslušných zdrojů, včetně nekomerční podmínky MorfFlex. MIT licence původního kódu neznamená MIT licenci těchto jazykových dat.
