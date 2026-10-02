# Dashboard-sync

Het dashboard is de startpagina van `tm.veerhoek.eu/` en leest
`hub/public/data/dashboard.yaml`. De dagelijkse OpenChamber-taak `dashboard-sync`
haalt Brightspace-data op en publiceert alleen een gevalideerd snapshot.

## Checkout en publicatie

De sync werkt **uitsluitend** in de aparte worktree
`/Users/max/Documents/technical-medicine/tm-site-dashboard-sync`, met een detached
HEAD gebaseerd op `origin/main`. De ontwikkelcheckout `tm-site` en zijn branches
worden nooit gebruikt voor sync-commits.

De worktree is eenmalig aangemaakt met `git worktree add --detach
../tm-site-dashboard-sync origin/main`. Bij iedere run:

1. Controleer dat de sync-worktree detached en volledig schoon is. Zo niet: stop.
2. Haal `origin/main` op en werk de detached HEAD alleen fast-forward bij. Zolang
   de dashboard-code en deze runbook nog niet op `main` staan: stop zonder wijzigingen.
3. Voer in de sync-worktree `bun dashboard-sync.ts prepare` uit. Bewaar de SHA
   die dit commando teruggeeft als `<base-sha>`. Het commando controleert de checkout,
   haalt `main` op en weigert achtergebleven ongepubliceerde commits.
4. Lees het bestaande snapshot voordat je Brightspace ophaalt. Bouw de nieuwe YAML
   als **candidate buiten de checkout**, bijvoorbeeld in een tijdelijke directory.
5. Valideer met `bun dashboard-check.ts /absolute/path/candidate.yaml`.
6. Publiceer met `bun dashboard-sync.ts publish /absolute/path/candidate.yaml <base-sha>`.
   Dit controleert opnieuw het schema, eigen items/velden en de basiscommit,
   commit uitsluitend het snapshot en pusht expliciet `HEAD:refs/heads/main`.
   Er is geen upstream op een ontwikkelbranch nodig. De bestaande workflow
   `Publish hub` valideert het snapshot opnieuw vóór deployment.

Als `main` tussentijds wijzigt, stopt publicatie; maak de candidate dan opnieuw
vanaf een nieuwe `prepare`-basis. Bij een mislukte push blijft de sync-commit staan
voor handmatige afhandeling. Nooit force-pushen, resetten, stashen of van branch
wisselen om een fout te omzeilen. Bij fouten geen nieuwe publicatie of vervolgstappen.

## Brightspace ophalen: per vak

Gebruik voor **elk** van onderstaande `courseId`'s apart:

| code | slug | courseId |
|---|---|---|
| TM12001 | asa | 844795 |
| TM12004 | dsd | 844797 |
| TM10004 | ms | 844825 |
| TM10006 | pc | 844835 |
| TM10012 | qsux | 845119 |

- `get_upcoming_due_dates` met `courseId` en `daysAhead: 45`.
- `get_calendar_events` met `courseId`, van vandaag tot het einde van het kwartaal.
  Laat `includeGenerated` uit: opdrachtdeadlines komen al uit due dates.
- `get_announcements` met `courseId` en `count: 20`. Dit is **geen** globale
  aanvraag gevolgd door filtering. Als de respons de count bereikt, verhoog deze
  en haal hetzelfde vak opnieuw op totdat de respons niet meer begrensd is.
  Als een toollimiet dit onmogelijk maakt, stop de sync en rapporteer de beperking.

Alle vijf vakken moeten succesvol zijn opgehaald voordat je een candidate maakt.
Een fout of ontbrekende respons is geen lege lijst. Organisatie-aankondigingen
en oude cursusinschrijvingen horen niet bij dit snapshot.

## Snapshot samenstellen

- `items`: vandaag en later, gesorteerd op `due`. Dedupliceer opdracht- en
  kalenderresultaten aan de hand van stabiele bron-ID's (`bs-` en `bse-`).
  Behoud de bestaande `done`- en `note`-waarden voor terugkerende items.
- Behoud **alle** `source: manual`-items exact, ook als hun datum voorbij is.
  Oude Brightspace-items mogen verdwijnen; de pagina verbergt verstreken items.
- `announcements`: de laatste acht **niet-vastgemaakte** per vak, plus alle
  vastgemaakte aankondigingen buiten die limiet. Sorteer nieuwste eerst.
  Behoud al bekende pinned-aankondigingen zolang hun verwijdering of gewijzigde
  pinned-status niet expliciet uit een volledige respons blijkt.
- Vat aankondigingen samen in één of twee Nederlandse zinnen. Houd je aan de bron:
  een vergaderlink is bijvoorbeeld niet automatisch een opname. Laat een mislukte
  fetch nooit eerder bekende informatie wissen.
- `synced_at`: het tijdstip van de laatste volledig geslaagde fetch, als ISO-string
  met expliciete UTC- of Amsterdam-offset. Behoud `quarter` en `courses`.

## Soorten en tijden

| kind | wanneer |
|---|---|
| `deadline` | inleveropdracht |
| `exam` | schriftelijk of mondeling tentamen |
| `presentation` | presentatie, pitch, poster |
| `assessment` | beoordelingsmoment van een opdracht |
| `session` | practicum, werkgroep, LT-spice-sessie |
| `lecture` | materiaalrelease of collegeblok |
| `other` | past nergens bij |

Bij twijfel: `other`; verzin geen soort of tijdstip. Voeg alleen aan nieuwe items
een korte Nederlandse `note` toe als de titel onduidelijk is.

Bewaar tijden als ISO-strings met seconden en expliciete tijdzone (`Z`, `+02:00`
of `+01:00`). UTC mag rechtstreeks uit de API worden overgenomen; de browser
rekent weergave, groepering en countdowns in `Europe/Amsterdam` uit, inclusief
zomer-/wintertijd. Gebruik `allday: true` alleen als de bron dit bevestigt; alleen
een tijdstip van 07:00 is geen bewijs van een materiaalrelease.

## Validatie en regressies

`bun dashboard-check.ts` valideert het gepubliceerde snapshot; geef een bestandspad
mee om een candidate te controleren. De gedeelde `dashboard-schema.js` controleert
arraytypen, verplichte velden, echte ISO-datums met tijdzone, unieke ID's per lijst,
vakreferenties, soorten, optionele booleans en absolute HTTP(S)-links. De browser
gebruikt hetzelfde schema voordat hij de cache vervangt.

Voer `bun test` uit voor regressies rond routing, datumlogica, cache en validatie.

## Nieuw kwartaal

Werk `quarter`, de `courses`-lijst en de courseId-tabel bij via een normale
ontwikkelbranch en merge naar `main`. Behoud nog openstaande handmatige items.
De volgende sync neemt de gepubliceerde configuratie over.
