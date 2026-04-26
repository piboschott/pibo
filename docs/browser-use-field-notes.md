# Browser Use Field Notes

Datum: 2026-04-26

Ziel: Browser Use ueber die Pibo Tool CLI praktisch erkunden und notieren, was fuer einen Agenten direkt verstaendlich ist, was unklar bleibt und wo das Surfen im Netz hakelig wird.

## Setup

Ausgangspunkt war die lokale Tool CLI:

```bash
npm run dev -- tools
```

Nuetzliche Einstiegsbefehle:

```bash
npm run --silent dev -- tools list
npm run --silent dev -- tools show browser-use
npm run --silent dev -- tools doctor browser-use
npm run --silent dev -- tools guides browser-use
npm run --silent dev -- tools guide browser-use browser-use
npm run --silent dev -- tools env browser-use
```

`browser-use` war bereits installiert unter:

```text
/home/pibo/.pibo/tools/browser-use/.venv/bin/browser-use
```

`doctor` meldete Browser, Netzwerk, venv und `profile-use` als ok. Einziger fehlender optionaler Baustein war `cloudflared`, der nur fuer Tunnel-Workflows relevant ist. Ein lokaler Desktop wurde erkannt, daher funktionierte `--headed`.

Fuer die Tests habe ich die Session `pibo-browser-study` verwendet. Headless wurde separat mit `pibo-browser-headless` getestet.

## Getestete Seiten

| Seite | Zweck | Ergebnis |
| --- | --- | --- |
| `https://www.wikipedia.org/` | Suche, Shadow-DOM-Input, Link-Klick, Back-Navigation | Erfolgreich |
| `https://en.wikipedia.org/wiki/Ada_Lovelace` | Artikelzustand auslesen, internen Link anklicken | Erfolgreich |
| `https://httpbin.org/forms/post` | Formular mit Text, Tel, Email, Radio, Checkbox, Time, Textarea und Submit | Erfolgreich |
| `https://www.selenium.dev/selenium/web/web-form.html` | Select, Datalist, Date, Checkbox, Screenshot, Werte auslesen | Erfolgreich |
| `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form` | Lange, komponentenreiche Seite; Scroll, HTML-Extraktion, JS-Eval | Erfolgreich mit lauter Ausgabe |
| `https://example.com` | Headless-Basistest | Erfolgreich |

## Was Direkt Einleuchtend War

- Die Pibo-Tool-CLI ist gut auffindbar: `list`, `show`, `doctor`, `env` und `guide` ergeben eine klare Reihenfolge.
- `doctor` ist hilfreich, weil er nicht nur Installation prueft, sondern auch Desktop-Variablen und optionale Komponenten nennt.
- Das Kernmodell ist einfach: `open`, dann `state`, dann mit den Indizes aus `state` interagieren.
- Benannte Sessions sind verstaendlich und praktisch:

```bash
browser-use --headed --session pibo-browser-study open https://www.wikipedia.org/
browser-use --session pibo-browser-study state
browser-use --session pibo-browser-study click 5824
browser-use --session pibo-browser-study back
```

- `input`, `click`, `keys`, `select`, `wait text`, `get title`, `get value`, `get html --selector`, `eval`, `scroll` und `screenshot` waren ohne zusaetzliche Recherche nutzbar.
- Headless funktioniert ohne Desktop-Exports, solange `PATH` und `BROWSER_USE_HOME` gesetzt sind.

## Beobachtete Erfolgsfaelle

Wikipedia:

- `open https://www.wikipedia.org/`
- `state` zeigte Sprachlinks und das Suchformular.
- `input 4 "Ada Lovelace"` schrieb in das Shadow-DOM-Suchfeld.
- `keys "Enter"` oeffnete den Artikel.
- `click 5824` folgte dem Link zu `Charles Babbage`.
- `get title` bestaetigte `Charles Babbage - Wikipedia`.
- `back` fuehrte zum Ada-Lovelace-Artikel zurueck.

httpbin-Formular:

- Textfelder wurden per `input` gefuellt.
- Radio und Checkbox wurden per `click` gesetzt.
- Time-Input akzeptierte `18:30`.
- `get value` bestaetigte Text- und Time-Werte.
- Submit lieferte auf `https://httpbin.org/post` die erwarteten Formdaten zurueck.

Selenium-Webformular:

- `select 11 "Two"` setzte ein echtes Select-Feld.
- `get value 11` gab `2` zurueck, also den Optionswert, nicht den sichtbaren Text.
- Datalist- und Date-Felder liessen sich per `input` setzen.
- `screenshot docs/browser-use-selenium-form.png` schrieb erfolgreich eine Bilddatei.

MDN:

- `scroll down` scrollte um 500 Pixel.
- `eval "window.scrollY"` bestaetigte die Scrollposition.
- `get html --selector "h1"` extrahierte gezielt die Ueberschrift.
- `eval` war fuer kompakte Extraktion sehr nuetzlich, z. B. `document.title`, `location.href` oder Elementzaehlung.

## Was Nicht Klar Oder Hakelig War

- Die CLI muss in jedem neuen Shell-Aufruf die Umgebung bekommen. Ohne `eval "$(pibo tools env browser-use)"` oder aequivalente `env`-Variablen ist nicht sofort klar, warum Browser Use eventuell nicht gefunden wird oder headed nicht startet.
- `state` zeigt fuer Textinputs nicht immer die aktuellen Werte. Bei Formularen musste ich `get value <index>` verwenden, um Eingaben sicher zu verifizieren.
- Die Indizes koennen ungewohnt wirken: Shadow-DOM-Inputs hatten kleine Indizes, waehrend Container und Links auf Wikipedia sehr hohe Indizes hatten. Man muss nach jeder Navigation oder groesseren DOM-Aenderung erneut `state` lesen.
- Auf grossen Seiten wie MDN wird `state` sehr lang und enthaelt Ads, Sidebars, Shadow-DOM-Komponenten und viele Navigationslinks. Fuer solche Seiten sind gezielte Befehle wie `get html --selector` oder `eval` besser als blindes `state`.
- `select` bestaetigt den sichtbaren Text, aber `get value` liefert den technischen Optionswert. Das ist korrekt, aber beim ersten Lesen leicht missverstaendlich.
- Einige Befehle geben sofort Output aus, laufen aber noch kurz weiter. Das fiel bei `input`/`click` auf; auf das Ende des Prozesses zu warten bleibt wichtig.
- Die Dokumentation sagt zurecht, mutierende Befehle nicht parallel in derselben Session auszufuehren. Fuer reine `get value`-Checks war Parallelisierung unproblematisch, aber fuer Navigation und Eingaben sollte man strikt seriell bleiben.

## Praktische Empfehlungen Fuer Agenten

1. Immer zuerst `npm run --silent dev -- tools doctor browser-use` und `npm run --silent dev -- tools env browser-use` ausfuehren.
2. Fuer jede Aufgabe eine benannte Session verwenden.
3. Nach `open`, `click`, `keys`, `select`, Submit oder grossem DOM-Wechsel erneut `state` lesen.
4. Bei Formularen `get value` nutzen, weil `state` Textwerte nicht immer zeigt.
5. Auf langen Seiten gezielt mit `get html --selector`, `get text`, `eval` und `wait text` arbeiten.
6. Mutierende Browserbefehle pro Session seriell ausfuehren.
7. Lange oder potenziell wartende Befehle mit `timeout 30s` oder `timeout 45s` kapseln.
8. Sessions am Ende mit `browser-use close` oder gezielt per Session schliessen.

## Offene Punkte

- Tunnel-Workflows wurden nicht getestet, weil `cloudflared` fehlt.
- Authentifizierte Profile wurden nicht getestet.
- File Upload wurde nicht getestet; das waere ein sinnvoller naechster Spezialtest.
- `extract` wurde nicht getestet, weil der lokale Guide davor warnt, dass es in dieser Version zwar gelistet, aber nicht implementiert ist.

## Nachgezogene Verbesserungen

Aus diesen Field Notes wurden folgende kleine Anpassungen am Pibo Browser-Use-Guide abgeleitet:

- Der Guide nennt jetzt explizit den Source-Repo-Aufruf `eval "$(npm run --silent dev -- tools env browser-use)"`.
- Der Guide betont, nach Navigation, Submit, Keypress-Navigation, groesseren DOM-Aenderungen oder Scrolls erneut `state` zu lesen.
- Der Guide empfiehlt fuer Formularpruefungen `get value <index>`, weil `state` aktuelle Textwerte nicht immer zeigt.
- Der Guide empfiehlt auf grossen Seiten gezielte Befehle wie `get html --selector`, `get text <index>` oder `eval` statt blindem `state`.
- Der Guide erklaert, dass `select` den sichtbaren Text bestaetigt, `get value` aber den technischen Optionswert liefert.
