# frc-search

Site search for fiercercsolutions.com: the instant dropdown, the phone search screen, and the results page with filters and Add To Cart.

## How it runs

- **Every night (about 3:15 AM Central)** the "Update search" job pulls all products from Shift4Shop, rebuilds the product list, checks it, and publishes it.
- **Run now:** open the **Actions** tab → **Update search** → **Run workflow** → **Run workflow**. Takes about a minute. Use it after adding products or big stock changes.
- Published files live at `https://fiercerc.github.io/frc-search/` and are loaded by the snippet in Shift4Shop **Settings → Design → Header & Footer → Global Footer**.

If the job ever fails, the last good version stays live. Nothing breaks on the store.

- **Settings sheet:** synonyms, popular searches, pinned results and shortcuts live in the "FRC Search Settings" Google Sheet (`settings.json` has its ID). Each update reads it. If it can't be read, the previous settings are kept.
- **Status page:** https://fiercerc.github.io/frc-search/status.html is the desktop control panel: index health, customer searches, and a Rebuild Search Index Now button.

The store is still on the preview snippet. Search appears only in browsers that opened the site with `?frcs=on`.

## Going live

When the preview is ready for every shopper:

1. In Shift4Shop **Settings → Design → Header & Footer → Global Footer**, replace the preview snippet (`footer-snippet.html`) with the contents of `live-snippet.html`. That loads the new search for everyone, with no preview badge. `?frcs=off` still turns it off in that browser if you ever need an emergency bypass (`?frcs=on` turns it back on).
2. Optionally, in the theme `frame.html`, comment out the old `<!--START:fbquicksearch-->` … `<!--END:fbquicksearch-->` block so FusionBot's old search does not load beside the new one.

Leave `footer-snippet.html` in the footer until that swap. Do not publish `live-snippet.html` early.

To record searches, paste `build/google_apps_script_logger.gs` into the settings spreadsheet (the steps are at the top of that file) and put the Web App URL in `settings.json` as `log_url`.

## Files

| Path | What it is |
|---|---|
| `site/frc-search.js` | The search (dropdown, phone screen, results page, Add To Cart) |
| `site/frc-search.css` | The look (matches the store: Roboto, navy, square corners) |
| `build/fetch_products.py` | Pulls products from the Shift4Shop API |
| `build/sheet_settings.py` | Reads the settings sheet and writes the control panel (`status.html`) |
| `build/google_apps_script_logger.gs` | Paste into the settings sheet to record customer searches |
| `footer-snippet.html` | Preview snippet (only runs with `?frcs=on`) |
| `live-snippet.html` | The snippet to paste when search goes live for everyone |
| `build/build_index.py` | Turns products into the search's product list. Also works from a product export CSV: `python3 build/build_index.py products.csv site/frc-index.js` |
| `data/frc-index.js` | Saved product list, used until the Shift4Shop keys are added |
| `data/links.json` | Product page addresses from the last export, used if the API leaves one out |
| `test/` | Checks that run before anything is published |

## Shift4Shop keys

Stored as GitHub secrets (Settings → Secrets and variables → Actions), never in the code:
`S4S_PRIVATE_KEY` (Developer Portal → FRC Search → Private Key) and `S4S_TOKEN` (same page, "Stores that are using this APP").
The store address defaults to `https://fiercercsolutions.com`; set an `S4S_SECURE_URL` secret only if it ever changes.
