# frc-search

Site search for fiercercsolutions.com: the instant dropdown, the phone search screen, and the results page with filters and Add To Cart.

## How it runs

- **Every night (about 3:15 AM Central)** the "Update search" job pulls all products from Shift4Shop, rebuilds the product list, checks it, and publishes it.
- **Run now:** open the **Actions** tab → **Update search** → **Run workflow** → **Run workflow**. Takes about a minute. Use it after adding products or big stock changes.
- Published files live at `https://fiercerc.github.io/frc-search/` and are loaded by the snippet in Shift4Shop **Settings → Design → Header & Footer → Global Footer**.

If the job ever fails, the last good version stays live. Nothing breaks on the store.

## Files

| Path | What it is |
|---|---|
| `site/frc-search.js` | The search (dropdown, phone screen, results page, Add To Cart) |
| `site/frc-search.css` | The look (matches the store: Roboto, navy, square corners) |
| `build/fetch_products.py` | Pulls products from the Shift4Shop API |
| `build/build_index.py` | Turns products into the search's product list. Also works from a product export CSV: `python3 build/build_index.py products.csv site/frc-index.js` |
| `data/frc-index.js` | Saved product list, used until the Shift4Shop keys are added |
| `data/links.json` | Product page addresses from the last export, used if the API leaves one out |
| `test/` | Checks that run before anything is published |

## Shift4Shop keys

Stored as GitHub secrets (Settings → Secrets and variables → Actions), never in the code:
`S4S_PRIVATE_KEY` (Developer Portal → FRC Search → Private Key) and `S4S_TOKEN` (same page, "Stores that are using this APP").
The store address defaults to `https://fiercercsolutions.com`; set an `S4S_SECURE_URL` secret only if it ever changes.
