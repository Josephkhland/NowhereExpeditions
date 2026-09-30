This folder will contain all my notes for the game of Nowhere Expeditions.

The folder public-site, will be deployed over on github as a static site.
The rest should remain local (for now).

See [RUNNING.md](RUNNING.md) for running the site and the content manager side by side in the VS Code terminal, and [DEPLOYING.md](DEPLOYING.md) for publishing `public-site/` to GitHub Pages.

## Local content manager

The sibling [content-manager](content-manager/README.md) project provides a local SQLite-backed editor for the Island Sheet, Campaign Rules, Characters, Gates, Expeditions, and Expedition Reports. Only records marked Published are written to the site. Run it with `python app.py` from that folder, then open <http://127.0.0.1:8001>. **Sync data** replaces only `public-site/data`; **Export to site** generates a complete replacement site in `site-export/` without changing `public-site/`.