# Table Insights

A local-only tool for the GM: measurements from Discord RP and session transcripts that help everyone get room to play. Standard-library Python, no dependencies. Like the content manager, it runs on this computer only (`127.0.0.1`).

**Private by design.** Results describe real players and quote them, so `data/` is gitignored and nothing here is exported to the site or posted to Discord. Every number is a prompt for the GM to take a look, never a verdict about a player.

## Pipeline

1. **Read a channel** with the bot (see `discord_server/bot/ask.py`):
   `python discord_server\bot\ask.py read <channel> --threads [--from --to] [--map FILE]`
   writes `discord_server/transcripts/<name>.md` and the raw `<name>.json`.
2. **Stats** (code only):
   `python -I table-insights\analyze.py <transcript.json> --id <session-id> [--gap 60]`
   writes `data/sessions/<id>.json` and the numbered reading copy `data/sessions/<id>.reading.md`. Re-running keeps moments and decisions.
3. **AI reading pass** (Claude, with the `table-insights` skill): reads the reading copy and drafts moments and funny-moment candidates, then
   `python -I table-insights\moments.py import <id> <draft.json>`
   checks every quote word for word against the transcript before saving.
4. **Review** in the dashboard: confirm or reject each proposal, add notes, record whether featured players agreed to a poll.
5. **Funny-moments poll** (optional): `python -I table-insights\moments.py poll <id>[,<id>...] [--hours 72]` drafts a poll from moments that are confirmed **and** agreed to, into `discord_server/embeds/`. Preview it with `python discord_server\bot\ask.py funny-poll <channel> <file> --preview`; posting goes through Vaulty and the GM's approval.

## Dashboard

```
cd table-insights
python -I app.py --open        # http://127.0.0.1:8002
```

Or the VS Code task **Table insights**.

- **Sessions:** spotlight share per scene (chart or table), the players table (share overall vs. share in scenes, words per turn, reply pace, rolls), flags worth a look, and the review queues for moments and funny moments, each with the transcript context one click away.
- **Players:** each player across sessions: scene share against the even share, confirmed moments by kind, funny moments. Use it to spot who hasn't had a story choice in a while.

The command line does the same reviews: `python -I moments.py list <id>`, `review <id> <m1|h1> confirm|reject|reset ["note"]`, `feature <id> <h1> ok|no`.

## Files

| File | What it does |
| --- | --- |
| `analyze.py` | Turns, sittings (scenes), shares, flags; the numbered reading copy. Thresholds in `SETTINGS`. |
| `moments.py` | Imports and validates the AI's proposals; review and consent decisions. |
| `app.py` | The dashboard server and its JSON API (`/api/sessions`, `/api/sessions/<id>`, `/api/sessions/<id>/context?n=`, `/api/players`, `POST /api/sessions/<id>/items/<item>`). Writes only from its own page. |
| `static/` | The dashboard (vanilla JS; everything from Discord is inserted as text, never HTML). |
| `data/sessions/` | Results. **Gitignored.** |
