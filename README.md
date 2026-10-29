# frc-search

Site search for fiercercsolutions.com: the instant dropdown, the phone search screen, and the results page with filters and Add To Cart.

## How it runs

- **Every night (about 3:15 AM Central)** the "Update search" job pulls all products from Shift4Shop, rebuilds the product list, checks it, and publishes it.
- **Run now:** open the **Actions** tab → **Update search** → **Run workflow** → **Run workflow**. Takes about a minute. Use it after adding products or big stock changes.
- Published files live at `https://fiercerc.github.io/frc-search/` and are loaded by the snippet in Shift4Shop **Settings → Design → Header & Footer → Global Footer**.

If the job ever fails, the last good version stays live. Nothing breaks on the store.

- **Settings sheet:** synonyms, popular searches, pinned results and shortcuts live in the "FRC Search Settings" Google Sheet (`settings.json` has its ID). Each update reads it. If it can't be read, the previous settings are kept.
- **Status page:** https://fiercerc.github.io/frc-search/status.html is the desktop control panel: index health, search counts for the last 30 days, and a Run an update now link (no GitHub key is stored in the browser).

**Status: LIVE for every shopper since Oct 29, 2026.** The Global Footer holds `live-snippet.html` plus a small cart-page rule that lines the Amazon Pay button up with the PayPal buttons (`#AmazonPayButton2 { width:100%; max-width:250px; margin-left/right:0 }`).

## Emergency off and rollback

- **One browser:** open the store with `?frcs=off` (back on with `?frcs=on`). Use this to compare or to bypass the new search on your own device.
- **Everyone:** in Shift4Shop **Settings → Design → Header & Footer → Global Footer**, replace the live snippet (from `<!-- Fierce RC Search. Loads for every visitor.` through `<!-- end Fierce RC Search -->`) with the contents of `footer-snippet.html` (preview-only: it does nothing unless a browser opened the site with `?frcs=on`). Save. The store is back on FusionBot immediately, because FusionBot's code was never removed from the theme (`frame.html` still has its `<!--START:fbquicksearch-->` block).
- The snippet hides FusionBot's results on the search page the instant it runs (no flash). If the new search can't load (GitHub Pages down, blocked script, or 15 seconds with no results), FusionBot's results come back by themselves.
- A copy of the whole Global Footer from before go-live is saved in the browser used for the change (localStorage key `frc_footer_backup_2026_10_29` on fiercercsolutions.com).

## After FusionBot is cancelled

Leave the theme's old FusionBot markup alone at first: the new search uses its `#searchBox` and `#fusionbot-content` containers as mount points. Re-check the search page after cancelling. Comment out the old `<!--START:fbquicksearch-->` … `<!--END:fbquicksearch-->` block in `frame.html` only after that check.

Search log: `build/google_apps_script_logger.gs` runs in the settings spreadsheet's Apps Script and saves searches to a separate PRIVATE spreadsheet ("FRC Search Log (private)"). Emails and long numbers are removed in the browser and again in the script; the public summary it serves has counts per term only. Update steps are at the top of that file. `log_url` in `settings.json` is the Web App URL; optional `log_sheet_url` adds an Open Private Search Log button to the control panel.

## Files

| Path | What it is |
|---|---|
| `site/frc-search.js` | The search (dropdown, phone screen, results page, Add To Cart) |
| `site/frc-search.css` | The look (matches the store: Roboto, navy, square corners) |
| `build/fetch_products.py` | Pulls products from the Shift4Shop API |
| `build/sheet_settings.py` | Reads the settings sheet and writes the control panel (`status.html`) |
| `build/google_apps_script_logger.gs` | Paste into the settings sheet to record customer searches |
| `footer-snippet.html` | Old preview-only snippet (only runs with `?frcs=on`). Kept as the rollback version |
| `live-snippet.html` | The snippet in the store's Global Footer now (search for everyone) |
| `build/build_index.py` | Turns products into the search's product list. Also works from a product export CSV: `python3 build/build_index.py products.csv site/frc-index.js` |
| `data/frc-index.js` | Saved product list, used until the Shift4Shop keys are added |
| `data/links.json` | Product page addresses from the last export, used if the API leaves one out |
| `test/` | Checks that run before anything is published |

## Shift4Shop keys

Stored as GitHub secrets (Settings → Secrets and variables → Actions), never in the code:
`S4S_PRIVATE_KEY` (Developer Portal → FRC Search → Private Key) and `S4S_TOKEN` (same page, "Stores that are using this APP").
The store address defaults to `https://fiercercsolutions.com`; set an `S4S_SECURE_URL` secret only if it ever changes.
