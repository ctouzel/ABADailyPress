# ABA Daily Press

Generates the ABA Daily Press newspaper front page from OOTP 26 HTML exports.

## Relationship to the earlier prototype

This project starts from the data-extraction pipeline of an earlier prototype
(kept separately as a reference, not in this repo): the OOTP HTML parser,
the snapshot builder (standings, leaders, box scores, injuries, transactions,
prospects, interviews, career leaders, the playoff bracket, salaries, and a
full Frontier League mirror), the article resolver, the history-sheet
context, and the columnist-writing engine. That layer is reused as-is here.

What's new in this repo is the front-page design: a "Modern Broadsheet" —
warm off-white ground, serif headlines, a green accent, a quick-overview
hero + sidebar above the fold, and full standings further down the same
page. See `src/views/renderFrontPage.mjs`.

## Project layout

```text
News/                       # Your OOTP export folder (gitignored)
src/
  parsers/ootpParser.mjs     # Generic HTML -> tables/text extraction
  services/
    snapshotBuilder.mjs      # HTML -> structured snapshot (standings, leaders, etc.)
    articleResolver.mjs      # Matches headlines to full article text
    historyContext.mjs       # Folds in the history-sheet workbook
    columnFactory.mjs        # Writes the columnist pieces from the stats
  views/renderFrontPage.mjs  # The Modern Broadsheet HTML template (new)
  data/historySheet.mjs      # Imported history workbook snapshot
  tools/import_history_sheet.py
dist/
  edition.html               # Rendered front page
  snapshot.json              # Parsed data, for debugging/tuning
league-config.json           # Optional overrides (gitignored; see .example)
Columnists/                  # Columnist portrait images
```

## Run it

```powershell
node .\src\index.mjs --input .\News --output .\dist
```

If you omit arguments, it defaults to `.\News` and `.\dist`.

## Optional config

Copy `league-config.example.json` to `league-config.json` to customize the
edition name and columnist voices.
