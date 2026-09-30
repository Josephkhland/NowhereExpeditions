# Publishing the site with GitHub Pages

The repository holds everything, but only `public-site/` is published. A GitHub Action (`.github/workflows/deploy-site.yml`) redeploys the site automatically whenever something inside `public-site/` changes on the `main` branch.

```
content manager (local)  ──Sync data──►  public-site/data  ──git push──►  GitHub Action  ──►  https://<user>.github.io/<repo>/
```

## What goes into Git

| Path | In Git? | Why |
| --- | --- | --- |
| `public-site/` | Yes | The published site. |
| `content-manager/` (code) | Yes | So the tool is versioned alongside the site. |
| `content-manager/content.db` | **No** | It contains unpublished GM material (secret NPCs, drafts, hidden sheets). Ignored by `.gitignore`. |
| `site-export/` | No | A generated copy; the Action deploys `public-site/` directly. Ignored by `.gitignore`. |

> **Anything pushed to a public repository is public, including its history.** Deleting a file later does not remove it from Git history. Only published records ever reach `public-site/data`, but double-check before your first push.

## One-time setup

1. **Update Git.** Git for Windows is installed at `E:\Git` (version 2.19.1, from 2018), and `E:\Git\cmd` is on the user PATH. Install the latest [Git for Windows](https://git-scm.com/download/win) over it, choosing the same `E:\Git` folder. Old versions can't sign in to GitHub reliably; the current one opens a browser window to sign in on the first push. Restart VS Code and any terminals afterwards.
2. **Create an empty repository on GitHub.** Don't add a README or .gitignore there, since this folder already has them. GitHub Pages is free for **public** repositories; private repositories need a paid plan.
3. **Enable Pages for Actions.** In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Before the first commit**, in the content manager:
   - Delete or unpublish **Sample Expeditioner** (it was only for previewing the layout), then press **Sync data**.
   - Glance through `public-site/data/` to confirm it holds only what players should see.
5. **Push the folder.** *(Done: the repository is `git@github.com:Josephkhland/NowhereExpeditions.git`, pushed over SSH with `~/.ssh/id_ed25519`, so no password or browser sign-in is needed.)* For reference, the steps were:

   ```powershell
   git init
   git add .
   git status            # confirm content.db and site-export/ are NOT listed
   git commit -m "Initial commit"
   git branch -M main    # the deploy workflow publishes from "main"
   git remote add origin git@github.com:Josephkhland/NowhereExpeditions.git
   git push -u origin main
   ```

6. Open the repository's **Actions** tab and watch **Deploy public site** run. When it finishes, the site's address appears in the run summary and under **Settings → Pages**.

## Everyday workflow

1. Run the content manager locally (see [RUNNING.md](RUNNING.md)) and make your edits. Tick **Published** on anything players should see.
2. Press **Sync data**. This rewrites `public-site/data/` from the database.
3. Commit and push:

   ```powershell
   git add public-site
   git commit -m "Update after session 12"
   git push
   ```

4. The Action deploys within a minute or two. Pushes that don't touch `public-site/` (for example, content-manager code) don't redeploy.

To redeploy without a change, use **Actions → Deploy public site → Run workflow**.

## Back up the database

Because `content.db` stays out of Git, it isn't backed up by the repository. Copy it somewhere private now and then (a cloud drive folder, an external disk). Stop the content manager first so the copy is complete. It is the only place unpublished material lives.

## Troubleshooting

- **`git` is not recognized:** `E:\Git\cmd` must be on PATH (it is on the user PATH). Programs started before it was added, including VS Code and open terminals, need a restart to see it.
- **Push asks for a password, or authentication fails:** the remote uses SSH, so check the key still works with `ssh -T git@github.com` (it should greet you by name). HTTPS remotes need an up-to-date Git for Windows (step 1), because GitHub no longer accepts account passwords.

- **The Action didn't run:** it only runs for pushes to `main` that change `public-site/` (or the workflow file). Use **Run workflow** for a manual deploy.
- **"Branch main is not allowed to deploy to github-pages":** the repository's default branch has a different name. Rename it to `main`, or change `branches: [main]` in the workflow.
- **The site shows a 404 right after the first deploy:** check that **Settings → Pages → Source** is set to **GitHub Actions**, then rerun the workflow.
- **Changes don't appear:** make sure you pressed **Sync data** before committing, then hard-refresh the browser (Ctrl+F5).
