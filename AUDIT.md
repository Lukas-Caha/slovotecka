# Audit projektu SLOVO.

Datum: 5. října 2026. Kontrolované soubory: `server.js`, všechny JS moduly v `src`, `public/app.js`, související HTML, konfigurace Nginx/PM2 a npm závislosti. Ignorované návrhové složky `template` a `newTemplate` nejsou součástí tohoto auditu.

Následující nálezy popisují stav před opravou. P1 znamená vysokou prioritu, P2 běžnou prioritu. Audit není zárukou absence dalších chyb.

## Stav oprav — 5. října 2026

Všech 11 nálezů níže má implementovanou opravu. Hráče nově identifikuje ověřený účet nebo podepsaná HttpOnly guest cookie; klientské ID a přezdívka nejsou dokladem vlastnictví. Identita chrání také oprávnění zakladatele arény. Události procházejí validací, omezenou frontou a kontrolou platnosti přihlášení. Chat escapuje uvozovky, statistiky z klienta se neimportují, arény mají limity a úklid, TLS ověřuje certifikáty, nová hesla respektují bcrypt limit a emote lze v DB vymazat.

Všech 21 regresních testů prošlo. Testy jsou v `tests/security.test.js` a spouštějí se přes `npm test`. Zahrnují skutečný HTTP/Engine.IO handshake, vstup do hry, výhru a odmítnutí neplatného paketu. Kontrola syntaxe všech 10 JS souborů a `git diff --check` také prošla. PostgreSQL operace jsou testované s nahrazeným poolem; připojení k produkční databázi a reálný prohlížeč nebyly ověřeny.

Při nasazení nastavte stabilní náhodný `SESSION_SECRET`, aby se guest identity zachovaly přes restarty. Bez něj se podpisový klíč generuje při startu. Pro další proxy mimo loopback nastavte jejich skutečné IP v `TRUST_PROXY_IPS`. Databáze s vlastní CA potřebuje `DB_SSL_CA_FILE`; SSL parametry z URL se převádějí do ověřované TLS konfigurace, protože podle [dokumentace node-postgres](https://node-postgres.com/features/ssl) mohou jinak přepsat objekt SSL.

Staré herní záznamy založené pouze na přezdívce nelze bezpečně přiřadit nové identitě, proto se jejich stav automaticky nepřebírá. Registrované účty zachovávají profilové statistiky z DB. Guest statistiky z localStorage se nově nepovažují za serverem ověřené výsledky. Oprávnění z příkazu `!admin` je po reconnectu potřeba znovu aktivovat; admin účty z `ADMIN_USERNAMES` se ověřují automaticky.

## 1. P1 — XSS v chatu přes HTML atributy

Místa: `public/app.js:2173`, `public/app.js:3302`, `public/app.js:3487`; další použití barev v HTML a `server.js:771`.

`escapeHtml` serializuje text přes `textContent` a `innerHTML`. Escapuje HTML značky, ale ponechá uvozovky. Výsledek se následně vkládá do atributů uvnitř HTML řetězce. Zpráva `" onpointerenter="window.__auditXss=1` vytvoří atribut `onpointerenter` na chatovém elementu. Zprávy může posílat i nepřihlášený klient do globálního chatu. CSP obsahuje `script-src 'unsafe-inline'`, takže inline obsluhy událostí nemá blokovat. Obdobný vstup umožňuje nesanitizovaná aktualizace barvy.

Dopad: JavaScript v prohlížečích ostatních návštěvníků při interakci s vloženým elementem; může provádět požadavky s jejich oprávněními, i když je cookie HttpOnly. Historie chatu šíří vadný obsah i dalším klientům.

Ověření: reprodukována tvorba HTML s vloženým atributem při spuštění původní funkce s modelem DOM textové serializace. Samotné spuštění v reálném prohlížeči nebylo testováno.

Oprava: textové části vytvářet přes DOM a `textContent`, atributy nastavovat přes DOM API. Pokud zůstanou šablony, escapovat i uvozovky pro atributový kontext. Barvy ověřovat na serveru při každé změně. Zpřísnění CSP použít jako další ochranu.

## 2. P1 — Admin práva přežijí změnu identity při reconnectu

Místa: `src/roomManager.js:205`, `src/roomManager.js:232`, `src/roomManager.js:241`; `public/app.js:5281`.

Reconnect rozhoduje pouze podle klientem dodaného `sessionId`, bez vazby na ověřený účet nebo jméno. Při převzetí objektu hráče se `isAdmin` pouze případně nastaví na true; při `isExplicitAdmin=false` se neodebere. Objekt je potom přejmenován.

Dopad: přechod z admin účtu na hosta nebo jiný účet se stejnou klientskou relací může přenést admin práva, pokud původní hráč ještě existuje v místnosti. Konkrétní scénář je odhlášení v jednom panelu prohlížeče, zatímco admin spojení v jiném panelu zůstává aktivní: klientské ID v localStorage je společné. Pokud se původní socket před reconnectem odstraní, tato konkrétní větev se neuplatní. Znalost cizího ID by umožnila převzít i jeho hráče; nebyl však nalezen důkaz, že se tato ID veřejně vysílají.

Ověření: hráč s admin právy a `sessionId=shared-session`; druhý socket s jiným jménem, stejným ID a `isExplicitAdmin=false` zůstane adminem.

Oprava: reconnect vázat na ověřenou identitu; při změně identity vytvořit nového hráče. Oprávnění znovu odvodit ze serverové autentizace. Admin práva získaná přes `!admin` udržovat ve vlastní ověřené relaci.

## 3. P1 — Stejná přezdívka přebírá cizí herní stav a tipy

Místa: `src/roomManager.js:293`, `src/roomManager.js:329`.

Nový hráč obnovuje stav podle jména. Při shodě základního jména dostane stav původního hráče i s jiným `sessionId`; předchozí tipy se přepíšou na jeho socket. Automatický suffix `(2)` neřeší vazbu na původního vlastníka.

Dopad: host může převzít cizí tipy, výhru či vzdání a získat řešení. Aktivní původní hráč může přijít o správné přiřazení tipů. Pro registrované přezdívky existuje kontrola účtu, ale hosty nechrání.

Ověření: Alice vyhrála; druhý socket se jménem Alice a jinou relací dostal `solved=true` a její tip změnil `socketId` na útočníka.

Oprava: herní historii a stav vázat na serverem ověřenou identitu/guest token, přezdívku používat pouze pro zobrazení.

## 4. P1 — Zakládání arén přes join_game obchází limit

Místa: `server.js:677`, `server.js:824`, `src/roomManager.js:2136`.

Limit pěti arén za hodinu kontroluje pouze `create_custom_room`. `join_game` také vytváří arénu, ale bez této kontroly. Opakované přechody do nových arén navíc odebírají hráče přes `prevRoom.removePlayer`, bez naplánování úklidu prázdné arény v `RoomManager.removePlayer`. Také arény vytvořené bez vstupu hráče nemají naplánovanou expiraci.

Dopad: neomezený růst mapy arén, paměti a objemu veřejných přehledů.

Ověření: sedm volání `join_game` z jednoho socketu/IP vytvořilo sedm arén. Testovací časovače byly vypnuté; chybějící naplánování úklidu při změně místnosti potvrzuje kontrola kódu.

Oprava: limit a validaci centralizovat do jediné cesty vytváření arén. Omezit počet arén celkově, délku kódu a uklízet prázdné arény i při změně místnosti a při vytvoření bez hráče.

## 5. P1 — Socketové limity používají podvržitelnou IP

Místa: `server.js:605`, `server.js:848`, `nginx-slovo.conf:57`.

Server bere první hodnotu `X-Forwarded-For` bez ověření proxy. Dodaná Nginx konfigurace používá `$proxy_add_x_forwarded_for`, který připojí skutečnou IP za hodnotu od klienta. Vlastní klient tedy může měnit první IP při dalších spojeních.

Dopad: obcházení limitů chatu, tipů a vytváření arén; také nesprávné IP v interních záznamech. Toto je nález pro socketové limity, nikoli automaticky pro HTTP login limiter, který používá `req.ip`.

Ověření: dvě zprávy ze stejné transportní adresy byly současně přijaty po změně prefixu `X-Forwarded-For`.

Oprava: odvozovat klientskou IP jen přes ověřený řetězec proxy; na veřejné vstupní proxy přepisovat nedůvěryhodné forwarding hlavičky. Přímý přístup k backendu odpovídajícím způsobem omezit.

## 6. P1 — Výpadek autentizace odemkne registrovaná jména

Místa: `src/authService.js:248`, `server.js:806`, `server.js:2037`.

Pokud není auth služba inicializovaná, `isUsernameTaken` vrací false. Po neúspěšné inicializaci DB nebo chybějícím produkčním `SESSION_SECRET` server pokračuje jako guest server. Dříve registrovaná jména pak přijímá bez autentizace. Socket si navíc ověřeného uživatele pamatuje z handshake a při dalších vstupech neověřuje platnost session znovu; smazání účtu nebo odhlášení samo neodpojí ostatní existující sockety.

Dopad: při startup výpadku DB lze vystupovat pod registrovaným jménem a měnit jeho lokální profil. Existující spojení může pokračovat se zastaralou identitou/oprávněními po zneplatnění session.

Ověření: statická kontrola chybových větví; nebyla připojena produkční PostgreSQL databáze ani testováno skutečné zneplatnění účtu.

Oprava: rozlišovat záměrně vypnuté účty od nedostupné nakonfigurované autentizace. Při druhém stavu blokovat vstupy vyžadující ověření jména. Zneplatnění session promítnout do připojených socketů.

## 7. P2 — Libovolný člen resetuje vlastní arénu

Místo: `server.js:693`.

`switch_custom_word_source` ověřuje typ místnosti, ale ne jejího zakladatele ani admina. Účastník může přepnout zdroj slov, což resetuje kolo. Nemá ani omezení frekvence.

Ověření: běžný člen arény jiného hostitele změnil zdroj z daily na archive.

Oprava: stejná kontrola zakladatele/admina jako u `start_speedrun`, plus omezení frekvence.

## 8. P2 — Chybí validace socketových vstupů a statistik

Místa: `server.js:709`, `server.js:795`, `server.js:956`, `src/playerProfileManager.js:183`, `src/playerProfileManager.js:313`.

Řada handlerů destrukturuje vstup bez kontroly a volá řetězcové metody nad nedůvěryhodnými hodnotami. `clientStats` dovoluje klientovi zadat libovolné výhry a série; při sloučení se navíc předpokládají iterovatelná pole.

Ověření: null u `send_global_chat`, `create_custom_room` a `submit_guess`, číselná zpráva a objekt místo pole statistik vyvolaly TypeError. Profil přijal 999999 výher a sérii 99999. Migrace existujícího profilu je omezena na profily s nulou odehraných her, ale nový profil podvržené hodnoty přijme rovnou.

Dopad: přerušení operací, spamování chybových logů a nedůvěryhodné statistiky. Globální `uncaughtException`/`unhandledRejection` pouze logují chyby, takže tyto reprodukce nejsou důkazem ukončení procesu.

Oprava: schéma všech událostí, kontrola typů a velikostí, bezpečné chybové odpovědi. Autoritativní statistiky počítat na serveru; importované historické výsledky oddělit.

## 9. P2 — DB TLS má vypnuté ověření certifikátu

Místo: `src/authService.js:12`.

`DB_SSL=true` a některé produkční konfigurace vracejí `rejectUnauthorized:false`. Spojení je šifrované, ale tato volba vypíná ověření serverového certifikátu; skutečné chování také závisí na SSL parametrech connection stringu.

Dopad: při aktivním síťovém útoku může klient přijmout falešný databázový server.

Ověření: statická kontrola konfigurace, bez připojení DB.

Oprava: používat ověřování certifikátu a důvěryhodnou CA odpovídající databázovému hostingu.

## 10. P2 — Hesla nad 72 bajtů se tiše zkracují

Místo: `src/authService.js:72`.

Validace povoluje 100 znaků, zatímco bcrypt pracuje jen s prvními 72 UTF-8 bajty. U českých znaků může hranice nastat dříve než na 72. znaku. [Dokumentace bcryptjs](https://github.com/dcodeIO/bcrypt.js/) uvádí tento limit i funkci `bcrypt.truncates`.

Ověření: hash hesla tvořeného 72 znaky A a příponou one přijal také příponu two. Obě hesla vyhovují současné validaci.

Oprava: odmítat hesla, která `bcrypt.truncates` vyhodnotí jako zkrácená, a limit vysvětlit také v UI. Změna hashovacího postupu vyžaduje kompatibilitu se stávajícími účty.

## 11. P2 — Odebraný emote se po přihlášení vrací

Místo: `src/authService.js:307`.

`saveUserProfile` převádí odebraný emote na SQL NULL, ale update používá `emote = COALESCE($3, emote)`. NULL tedy znamená ponechat původní hodnotu, nikoli ji vymazat. Při dalším loginu se stará hodnota načte z DB.

Ověření: statická kontrola předávaného parametru a SQL, bez PostgreSQL integračního testu.

Oprava: rozlišit neposkytnutou hodnotu a explicitní smazání, aby smazání provedlo `emote = NULL`.

## Provedené kontroly a jejich limity

- `node --check`: všech 8 produkčních JavaScript souborů prošlo kontrolou syntaxe.
- `npm ls --depth=0`: přímé závislosti jsou nainstalované; Express 4.22.3, Socket.IO 4.8.3, bcryptjs 3.0.3, pg 8.23.1, Helmet 8.3.0.
- `npm audit --omit=dev --json`: 0 známých zranitelností, 106 produkčních závislostí podle npm reportu.
- Chování roomManageru, profilů a socketových handlerů bylo reprodukováno spuštěním původních souborů v Node VM s nahrazenými síťovými/DB objekty, zápisy na disk a časovači. Herní slovní služba a CSV data byly skutečné. Nešlo o integrační test živého serveru.
- Projekt nemá npm test script ani nalezenou automatickou testovací sadu. Produkční DB, reálný prohlížeč, skutečná proxy a přehrávání YouTube nebyly ověřeny.

Doporučené pořadí oprav: XSS; vazba identity a admin oprávnění; vlastnictví herní historie; limity a úklid arén; důvěryhodné IP a chování při výpadku auth; zbývající P2 nálezy.
