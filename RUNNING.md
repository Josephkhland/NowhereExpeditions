# Running the site and the content manager locally

This covers running both parts of the project side by side from the integrated terminal in **Visual Studio Code**, with this folder (`NowhereExpeditions`) opened as the workspace. (If you use full Visual Studio instead, the commands are identical; use **View → Terminal** and its split button.)

You only need **Python 3** (already used by the content manager). No install step and no packages.

| What | Folder | Command | Open in browser |
| --- | --- | --- | --- |
| Content manager | `content-manager/` | `python app.py` | <http://127.0.0.1:8001> |
| Public site | `public-site/` | `python -m http.server 8000 --bind 127.0.0.1` | <http://127.0.0.1:8000> |

> The public site must be served over HTTP. Opening `public-site/index.html` by double-clicking it (a `file://` address) will not work, because the pages load their data with `fetch()`, which browsers block for local files.

---

## 1. Open the project

1. In VS Code: **File → Open Folder…** and choose `C:\Shared\RPGs\NowhereExpeditions`.
2. Open a terminal: **Terminal → New Terminal** (or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>`</kbd>). It starts in the project folder.

## 2. Start the content manager (terminal 1)

```powershell
cd content-manager
python app.py
```

You should see `Content manager ready at http://127.0.0.1:8001`. <kbd>Ctrl</kbd>+click the address to open it. Leave this terminal running.

## 3. Start the public site (terminal 2)

Split the terminal so both stay visible: click the **split** icon in the terminal panel's toolbar (or press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>5</kbd>). The new pane also starts in the project folder:

```powershell
cd public-site
python -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000>. Leave this running too.

Tip: right-click each terminal in the list on the right of the panel → **Rename** (e.g. "manager" and "site") to tell them apart.

## 4. Everyday workflow

1. Edit content in the manager and press **Save**. This only changes the local SQLite database.
2. Tick **Published** on any record that should appear on the site.
3. Press **Sync data** in the manager. This rewrites `public-site/data/` from the database.
4. Refresh the public site tab. If you still see old content, do a hard refresh (<kbd>Ctrl</kbd>+<kbd>F5</kbd>).

Edits to the site's own files (`*.html`, `styles.css`, `site.js`) show up on refresh as well; neither server needs restarting. The content manager *does* need a restart (<kbd>Ctrl</kbd>+<kbd>C</kbd>, then `python app.py` again) after changes to `content-manager/app.py`.

**Export to site** is separate: it builds a complete, deployable copy in `site-export/` and does not touch `public-site/`. To preview that copy, run a third server:

```powershell
python -m http.server 8002 --bind 127.0.0.1 --directory site-export
```

## 5. Stopping

Click into each terminal and press <kbd>Ctrl</kbd>+<kbd>C</kbd>. Closing the terminal (trash-can icon) also stops it.

---

## Optional: start both with one command

VS Code can launch both servers at once with a task. This is already set up in `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Content manager",
      "type": "shell",
      "command": "python app.py",
      "options": { "cwd": "${workspaceFolder}/content-manager" },
      "isBackground": true,
      "presentation": { "group": "servers", "panel": "dedicated" },
      "problemMatcher": []
    },
    {
      "label": "Public site",
      "type": "shell",
      "command": "python -m http.server 8000 --bind 127.0.0.1",
      "options": { "cwd": "${workspaceFolder}/public-site" },
      "isBackground": true,
      "presentation": { "group": "servers", "panel": "dedicated" },
      "problemMatcher": []
    },
    {
      "label": "Run both",
      "dependsOn": ["Content manager", "Public site"],
      "problemMatcher": []
    }
  ]
}
```

Then **Terminal → Run Task… → Run both**. The two servers open side by side in split terminals (the shared `"group": "servers"` does that). Stop them with **Terminal → Terminate Task…**.

---

## Troubleshooting

- **`python` is not recognized**: try `py app.py` / `py -m http.server 8000` (the Windows Python launcher). If neither works, install Python 3 from python.org and tick "Add python.exe to PATH".
- **Port already in use** (`OSError: [WinError 10048]`): something else, often an earlier run you forgot about, is using the port. Stop it, or pick another port: `python app.py --port 8011` or `python -m http.server 8010`.
- **Site pages say data could not be loaded**: make sure you opened the `http://127.0.0.1:8000` address, not the HTML file directly, and that the site server was started from inside `public-site`.
- **Manager changes don't appear on the site**: press **Sync data**, check the record is **Published**, then hard-refresh.
