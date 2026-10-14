# Nowhere Expeditions desktop app

One window for the local toolkit, instead of a pile of browser tabs and PowerShell windows. Built on Electron. It runs the servers and the bot itself (see the Terminal tab) and shows each tool in a tab; `tools/start-everything.ps1` and the desktop shortcut open it.

| Tab | Address | Shortcut |
| --- | --- | --- |
| Live site | https://josephkhland.github.io/NowhereExpeditions/ (the published site) | Ctrl+1 |
| Content manager | http://127.0.0.1:8001 | Ctrl+2 |
| Draft site | http://127.0.0.1:8000 (public-site/, not yet published) | Ctrl+3 |
| Table insights | http://127.0.0.1:8002 | Ctrl+4 |
| Bot dashboard | handed over by the bot | Ctrl+5 |
| Terminal | the servers', the bot's and Claude Code's terminals | Ctrl+6 |
| Git | changes, diffs, commits, publishing to the live site | Ctrl+7 |

The **Live site** tab shows an address field in the tab bar (Ctrl+L to jump to it): edit it and press Enter to go there, Esc to undo. Links within the site stay in the tab; links elsewhere open in your browser.

- **One window only.** Launching it again (the shortcut, the VS Code task) brings the open window to the front; `--tab=insights` also switches tab.
- **Tabs load when you first open them** (grey dot until then), so tools you don't use cost no memory. Each opened tab is its own browser process, a few hundred MB.
- **Servers that aren't up yet** show an orange or red dot; the tab you're looking at retries every 2 seconds, background tabs try again when you open them.
- **Links** to another tool open in that tool's tab; anything else opens in your normal browser. Right-click for copy/paste and "Open link in browser"; ↗ opens the current page in the browser (never the bot dashboard).
- **Right-click a tab** to restart its server (or the bot), see its output, or restart all servers.
- **Keys:** Ctrl+R reload, Alt+Left back, Ctrl+= / Ctrl+- / Ctrl+0 zoom, F12 developer tools, Ctrl+Shift+R restart all servers, Ctrl+Alt+R reload interface. Alt shows the menu.
- The window remembers its size, position and last tab.

## The Terminal tab

What used to be four PowerShell windows, plus one for Claude Code, as sessions in a side panel (xterm.js on screen, node-pty behind it):

| Session | Runs (in) |
| --- | --- |
| Claude Code | `claude` in PowerShell (repo folder); when it exits you're at the PowerShell prompt |
| Content manager | `python app.py` (content-manager) |
| Draft site | `python -m http.server 8000 --bind 127.0.0.1` (public-site) |
| Table insights | `python -I app.py` (table-insights) |
| Discord bot | `.venv\Scripts\python.exe run_bot.py --open-dashboard` (discord_server/bot); answer its y/n approvals here |

- **The servers and the bot start with the app** and **stop when you close it** (it asks first). `--no-bot` / `--no-insights` skip one at launch, `--open-only` starts none (the VS Code "Everything" task uses that, since VS Code runs them).
- **Anything already running elsewhere** (an old PowerShell window, VS Code) is left alone and shown as "running outside the app" (orange). Close it there, then press Enter or ▶ to run it here.
- **Claude Code starts when you ask** (press Enter in its session, or ▶), since it takes a few hundred MB. ⟲ instead runs `claude --continue`, reopening the last conversation in this folder: after restarting the app, that's how you pick up where you were (or type `/resume` in a new session to choose another).
- **Folder bar** above each session: where it runs. Claude Code's is editable: type another folder and press Enter (if it's running, it asks, then restarts there; ⟲ reopens that folder's last conversation). The app remembers it. The servers' folders are fixed.
- **Claude Code actions:** with Claude Code selected, a tree of the project's Claude Code flows appears under the sessions (transcripts and session reports, table insights, lore, the bot, publishing). Clicking one types its request into Claude Code's input without sending it: fill in the `<…>` parts and press Enter. Some just open a tab (the insights dashboard, the Git tab). The tree is `claude-actions.json`: edit it to add your own, then Reload interface.
- **Claude's memory** (the button under the sessions, with Claude Code selected): the notes Claude Code keeps about the project in its folder (`~/.claude/projects/<folder>/memory/`, indexed by `MEMORY.md`, which every session starts by reading), drawn as a graph: one card per note, colored by kind (about you, your feedback, project, reference), lines for their `[[links]]`, dashed cards for links to notes not written yet. Click a card to read it (its links are clickable), drag cards to arrange them, × to delete one: it moves to `memory-trash` beside the memory folder with its index line, and "Recently deleted" restores it. Sessions started after a delete won't know the note; one that's already running may still remember it. Esc closes.
- **Reload interface** (Ctrl+Alt+R, the Servers menu or right-click a tab) reloads the tab bar and the Terminal tab's page, so changes to `shell.*`, `terminal.html`, `terminal.css`, `terminal-page.js` and the preloads show up without a restart. Claude Code, the servers and the bot keep running and their output is replayed. Changes to `main.js` or `terminal.js` still need a restart.
- Each session's row has ↻ restart and ■ stop while it runs, ▶ start when it doesn't; "Restart all servers" sits at the bottom. A server that stops shows red, here and on the Terminal tab's dot; press Enter in it to start it again. Stopping sends Ctrl+C first and ends it after 3 seconds if needed. When a server comes back up, its tab reloads.
- **Keys:** Ctrl+C copies when text is selected, otherwise it interrupts as usual; Ctrl+V pastes (with an image on the clipboard it passes through to Claude Code); right-click copies the selection or pastes; Shift+Enter is a new line in Claude Code; Ctrl+= / Ctrl+- / Ctrl+0 change the font size. Ctrl+R and the other app shortcuts go to the terminal here, except Ctrl+1 to Ctrl+7.
- Output is kept in memory only (the bot's can include its dashboard link): reloading the tab replays it, nothing is written to disk.

## The Git tab

Plain git on this repository (no GitHub CLI needed; pushes use the existing SSH key):

- **Toolbar:** switch branch, start a new branch (your uncommitted changes come along), Fetch, Pull (only when no merge is needed) and Push, with how far you are ahead of or behind GitHub.
- **Changes:** staged and not-staged files; click one to see its diff, + / − to stage or unstage, then write a message and Commit (Ctrl+Enter). Changes made elsewhere (Claude Code, an editor) show up within a few seconds.
- **History:** a commit graph like VS Code's: colored lanes show how branches split off and merge back (hollow dots are merges), with chips where branches and tags point: your branches (filled = the one you're on, ☁ = same as on GitHub), GitHub-only branches (☁ origin/…) and release tags (◆ v1.0.8, one per deploy of the live site). "Show" switches between all branches and this branch only. Commits on your branch that GitHub doesn't have are marked "not pushed". Click one to see everything it changed.
- **Publish:** after checking GitHub, lists the commits and files that would reach `main` (click a file for its diff) and says whether the live site will redeploy (only changes under `public-site/` and the deploy files do; see DEPLOYING.md). Then:
  - on `main`: pushes it;
  - on another branch: pushes the branch, merges it into `main` with a merge commit (like a pull request), pushes `main`, and switches back to the branch.

  It asks first, and refuses when the preview is out of date, when GitHub's `main` has commits you don't have, or (on a branch) when you have uncommitted changes. A merge with conflicts is undone and nothing is published. "Deploys on GitHub ↗" opens the Actions page to watch the deploy.
- Every command that changes something, and its output, is shown under **Output**. The tab never force-pushes, resets or discards changes; for anything unusual, ask Claude Code in the Terminal tab.

## The bot dashboard and its key

The dashboard link contains the key that approves the bot's actions. When the bot starts with `--open-dashboard`, it writes the link into the app's private named pipe (`\\.\pipe\nowhere-expeditions-app`) instead of opening the browser. The app:

- accepts only links to `http://127.0.0.1:8766/`, so nothing else can be pushed into the window;
- keeps the link in memory: it is never logged, saved, shown in the tab bar, passed on a command line or sent back through the pipe;
- never opens the dashboard in the browser.

If the app isn't running when the bot starts, the bot opens the browser as before. If the bot was already running outside the app when the app opened, the dashboard tab stays greyed out until the bot restarts (its dashboard has a Restart button), or use the link in the bot's window. Restarting the bot from the app gives it a new key and hands the new link over.

## Setup

```
cd desktop-app
npm install
```

`node_modules/` is gitignored. node-pty ships prebuilt Windows binaries, so nothing is compiled; terminals use its bundled ConPTY (`useConptyDll`), because the system one's kill needs a helper process that fails under Electron. Run it on its own with `npm start` or `node_modules\electron\dist\electron.exe .`.

Development helpers: `NE_APP_CAPTURE=<file.png>` saves the window after a few seconds and quits (`NE_APP_CAPTURE_RELOAD=<ms>` also reloads the interface partway, `NE_APP_CAPTURE_CLICK=<CSS selector>` clicks something in the open tab first) (its Claude Code session is plain PowerShell, started at once); `NE_APP_DEBUG=<file>` logs pipe and shutdown events (never URLs). To test while the app is open, add `--user-data-dir=<temp folder>` so the test copy doesn't just focus the open window, and keep the real servers running so the test copy leaves them alone (it marks them "outside the app"). If the capture fails with `UnknownVizError` (low memory), add `--disable-gpu`.
