# Kompetansequiz

Quiz i faget som tester om eleven har nådd kompetansemålene på udir.no (LK20).
Hvert spørsmål er knyttet til ett kompetansemål. Resultatsiden viser hvilke mål som er **nådd**
(alle spørsmål om målet besvart riktig) og hvilke som må øves mer på.

```bash
npm install
npm start
# åpne http://localhost:3000
```

Krever Node 18+.

## Hvor kommer spørsmålene fra?

1. **Ferdig spørsmålsbank** i `data/banks/<slug>.json`. Finnes for standardlenken (TAN03-03, kv476): 48 fagspørsmål, 3–6 per mål. Bør kvalitetssikres av faglærer.
2. **Generert av Claude** for lenker uten ferdig bank. Genereres én gang og lagres i `data/generated/<slug>.json`. Krever `ANTHROPIC_API_KEY`.
   - «Innstillinger → Generer nye spørsmål med Claude» lager nye. En generert bank brukes foran den ferdige. Slett filen i `data/generated/` for å gå tilbake.

Slug = URL-stien, f.eks. `lk20-tan03-03-kompetansemaal-og-vurdering-kv476`.

## Konfigurere lenke til kompetansemål

Standard: `https://www.udir.no/lk20/tan03-03/kompetansemaal-og-vurdering/kv476`

- **I appen:** «Innstillinger» → lim inn lenke → «Bruk og start på nytt» (lagres i nettleseren).
- **Via adressefeltet:** `http://localhost:3000/?url=https://www.udir.no/lk20/.../kompetansemaal-og-vurdering/kv123&perGoal=2`
- **Ny standard for serveren:** `LEARNING_GOALS_URL=https://www.udir.no/... npm start` (se `.env.example`)

## GitHub Pages (statisk versjon)

`npm run build` lager en statisk versjon i `dist/`. Den henter kompetansemålene fra udir.no
ved build og legger dem sammen med spørsmålsbankene som JSON. Quizen kjører da helt i nettleseren.

- `.github/workflows/pages.yml` bygger og publiserer ved push til `main`.
- Nettversjonen har bare læreplaner med spørsmålsbank i `data/banks/`. Andre lenker og Claude-generering krever lokal server (`npm start`).
- `data/generated/` er ikke i git. Vil du publisere en generert bank, flytt filen til `data/banks/`.

## Sikkerhet

- Serveren henter bare `https://www.udir.no`-lenker og følger ikke videresendinger (hindrer SSRF).
- Lytter kun på `127.0.0.1`. API-kall fra andre nettsider avvises (`Sec-Fetch-Site: cross-site`), så de ikke kan bruke API-kreditt.
- API-nøkkel leses fra miljøvariabel, aldri fra kode.

## API

- `GET /api/quiz?url=…&perGoal=1` – spørsmål for alle mål + måloversikt
- `POST /api/generate?url=…` – lag ny spørsmålsbank med Claude
- `GET /api/goals?url=…` – parsede kompetansemål
