# Dashboard-sync

De dashboardpagina op `tm.veerhoek.eu/dashboard/` leest `hub/public/dashboard/data.yaml`.
Dit bestand is de bron van waarheid en wordt bijgewerkt door een agentsessie (handmatig
of via de dagelijkse OpenChamber-taak "dashboard-sync") die deze runbook volgt.

## Procedure

1. Haal data op via de Brightspace MCP-tools:
   - `get_upcoming_due_dates` met `daysAhead: 45`
   - `get_calendar_events` van vandaag tot het einde van het kwartaal (default false voor
     `includeGenerated`; opdrachtdeadlines komen al uit due dates)
   - `get_announcements` met `count: 20`
2. Filter op de vakken van dit kwartaal (courseId's, update bij nieuw kwartaal):

   | code | slug | courseId |
   |---|---|---|
   | TM12001 | asa | 844795 |
   | TM12004 | dsd | 844797 |
   | TM10004 | ms | 844825 |
   | TM10006 | pc | 844835 |
   | TM10012 | qsux | 845119 |

   Aankondigingen van organisatie-"vakken" (zoals Students Mechanical Engineering) vallen weg.
3. Werk `hub/public/dashboard/data.yaml` bij:
   - `items`: alles wat komt (vandaag en later), gesorteerd op `due`. Bestaande items
     herken je aan hun `id` (`bs-`/`bse-` + Brightspace-id). **Behoud altijd** de velden
     `done`, `note` en alle items met `source: manual`; ze zijn van Max, niet van Brightspace.
     Items waarvan de datum voorbij is verdwijnen uit het bestand (de pagina toont ze niet meer).
   - `announcements`: hooguit de laatste 8 per vak, nieuwste eerst, met een samenvatting
     van 1–2 zinnen in het Nederlands. Bewaar pinned-aankondigingen.
   - `synced_at`: nu, in Europe/Amsterdam met offset.
4. Classificeer elk item met een `kind`:

   | kind | wanneer |
   |---|---|
   | `deadline` | inleveropdracht (dropbox/assignment) |
   | `exam` | schriftelijk of mondeling tentamen (toets, tentamen, examen, test) |
   | `presentation` | presentatie, pitch, poster |
   | `assessment` | beoordelingsmoment/eindbeoordeling van een opdracht |
   | `session` | bijeenkomst zonder inlevermoment (practicum, werkgroep, LT-spice-sessie) |
   | `lecture` | verschijnend materiaal / collegeblok op de kalender |
   | `other` | past nergens bij |

   Bij twijfel: `other` plus een heldere `note`. Voeg een korte Nederlandse `note` toe als
   de titel onduidelijk is.
5. Tijden: zet UTC om naar Europe/Amsterdam met offset (`+02:00` zomertijd, `+01:00` na de
   wissel eind oktober). Kalender-events om 07:00 zonder expliciete tijd in de titel zijn
   materiaalreleases: `allday: true` zetten.
6. Valideer en publiceer:

   ```sh
   cd tm-site
   bun -e 'const d = Bun.YAML.parse(await Bun.file("hub/public/dashboard/data.yaml").text()); if (!d.items || !d.announcements || !d.synced_at) process.exit(1); console.log("yaml ok:", d.items.length, "items")'
   ```

   Bij gewijzigde data: commit naar `main` met een kort bericht als `Sync dashboard data`
   en push. De GitHub-workflow "Publish hub" deployt daarna automatisch. Wijzig je niets,
   dan commit en push je ook niet.

## Handmatige items

Eigen mijlpalen (mondelinge inschrijvingen, studeerdoelen) voeg je toe met
`source: manual` en een eigen id (`manual-1`, `manual-2`, …). De sync laat ze met rust.
Later (zelfstudie-tracker) komen hier ook voortgangsvelden bij; houd de schema-uitbreidingen
compatibel: alleen velden toevoegen.

## Nieuw kwartaal

Vervang `quarter`, werk de `courses`-lijst en de courseId-tabel hierboven bij, en begin
met een schone `items`-lijst (bewaar eventueel nog openstaande handmatige items).
