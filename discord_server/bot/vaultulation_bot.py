"""Vaultulation, the Nowhere Expeditions Discord bot.

Run it yourself, in your own terminal, with the venv active:

    python discord_server\\bot\\vaultulation_bot.py

The token is read from Windows Credential Manager (keyring service "Vaultulation",
user "bot") and never printed. While the bot runs, it serves a small API on
127.0.0.1 so Claude sessions can work with the server through ask.py without ever
holding the token.

Read requests (GET) are answered directly. Write requests (POST /actions/...) are
never carried out on their own: the bot prints a summary in this terminal and only
acts if you answer "y". Every decision is appended to actions.log next to this file.
"""

import asyncio
import datetime
import hmac
import io
import json
import os
import random
import secrets
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import discord
import keyring
from aiohttp import web

import names as namegen
import tarot

SERVICE = "Vaultulation"
USERNAME = "bot"
HOST = "127.0.0.1"
PORT = 8765
ACTIONS_LOG = Path(__file__).with_name("actions.log")
POLLS = Path(__file__).with_name("polls")  # one JSON file per tarot reading (gitignored)
DATA = Path(__file__).with_name("data")  # consent records (gitignored)
CONSENT_FILE = DATA / "consent.json"  # role, terms version, who accepted
CONSENT_LOG = DATA / "consent-log.jsonl"  # every accept / withdraw, append-only
DASHBOARD_PORT = 8766
DASHBOARD_HTML = Path(__file__).with_name("dashboard.html")
APPROVAL_TIMEOUT = 590  # seconds; just under ask.py's 10-minute wait
RESTART_CODE = 3  # run_bot.py starts the bot again when it exits with this
SUPERVISED = os.environ.get("VAULTULATION_SUPERVISED") == "1"  # started through run_bot.py
OPEN_DASHBOARD = "--open-dashboard" in sys.argv
DIALOGS = sys.platform == "win32" and "--no-dialogs" not in sys.argv


def windows_yes_no(caption, text):
    """A Windows Yes/No message box, brought to the front and focused. True for Yes."""
    import ctypes
    MB_YESNO, MB_ICONQUESTION, MB_TOPMOST, MB_SETFOREGROUND = 0x4, 0x20, 0x40000, 0x10000
    threading.Thread(target=focus_dialog, args=(caption,), daemon=True).start()
    return ctypes.windll.user32.MessageBoxW(
        0, text, caption, MB_YESNO | MB_ICONQUESTION | MB_TOPMOST | MB_SETFOREGROUND) == 6  # IDYES


def focus_dialog(caption):
    """Windows won't let a background program take focus on its own. Once the box exists,
    borrow the input of the window currently in front (AttachThreadInput), bring the box
    forward and focus it; if Windows still refuses, at least flash it in the taskbar."""
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    hwnd = 0
    for _ in range(40):  # wait up to ~2 s for the box to appear
        hwnd = user32.FindWindowW(None, caption)
        if hwnd:
            break
        time.sleep(0.05)
    if not hwnd:
        return
    front = user32.GetForegroundWindow()
    front_thread = user32.GetWindowThreadProcessId(front, None)
    box_thread = user32.GetWindowThreadProcessId(hwnd, None)
    attached = front_thread and front_thread != box_thread and user32.AttachThreadInput(front_thread, box_thread, True)
    try:
        user32.ShowWindow(hwnd, 5)  # SW_SHOW
        user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002)  # HWND_TOPMOST, no move/size
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        user32.SetFocus(hwnd)
    finally:
        if attached:
            user32.AttachThreadInput(front_thread, box_thread, False)
    if user32.GetForegroundWindow() != hwnd:
        class FLASHWINFO(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.UINT), ("hwnd", wintypes.HWND), ("dwFlags", wintypes.DWORD),
                        ("uCount", wintypes.UINT), ("dwTimeout", wintypes.DWORD)]
        info = FLASHWINFO(ctypes.sizeof(FLASHWINFO), hwnd, 0x3 | 0xC, 0, 0)  # FLASHW_ALL | FLASHW_TIMERNOFG
        user32.FlashWindowEx(ctypes.byref(info))
    user32.MessageBeep(0x20)  # MB_ICONQUESTION sound


def close_windows_dialog(caption):
    """Close an open message box (answered elsewhere) by pressing its No button."""
    import ctypes
    hwnd = ctypes.windll.user32.FindWindowW(None, caption)
    if hwnd:
        ctypes.windll.user32.PostMessageW(hwnd, 0x0111, 7, 0)  # WM_COMMAND, IDNO

# Discord's embed limits.
EMBED_LIMITS = {"title": 256, "description": 4096, "footer": 2048, "author": 256,
                "field_name": 256, "field_value": 1024, "fields": 25, "total": 6000}


def visibility(channel):
    """Who is explicitly allowed or denied View Channel here (roles and members)."""
    allowed, denied = [], []
    for target, overwrite in channel.overwrites.items():
        allow, deny = overwrite.pair()
        name = getattr(target, "name", str(target.id))
        if allow.view_channel:
            allowed.append(name)
        if deny.view_channel:
            denied.append(name)
    return {"allowed": allowed, "denied": denied}


def channel_info(channel):
    category = getattr(channel, "category", None)
    return {
        "id": str(channel.id),
        "name": channel.name,
        "type": str(channel.type),
        "category": category.name if category else None,
        "position": channel.position,
        "topic": getattr(channel, "topic", None),
        "slowmode": getattr(channel, "slowmode_delay", 0),
        "synced": getattr(channel, "permissions_synced", None),
        "view": visibility(channel),
    }


def role_info(role):
    return {
        "id": str(role.id),
        "name": role.name,
        "position": role.position,
        "managed": role.managed,
        "colour": str(role.colour),
    }


MAX_READ = 10000  # messages per read request


def message_info(message):
    reference = message.reference.message_id if message.reference else None
    # For a bot's answer to a slash command (e.g. a Dice Maiden roll): who ran the command.
    interaction = getattr(message, "interaction_metadata", None) or getattr(message, "interaction", None)
    invoker = getattr(interaction, "user", None)
    return {
        "invoked_by": invoker.display_name if invoker else None,
        "id": str(message.id),
        "time": message.created_at.isoformat(),
        "edited": message.edited_at.isoformat() if message.edited_at else None,
        "author_id": str(message.author.id),
        "author": message.author.display_name,
        "bot": message.author.bot,
        "webhook": message.webhook_id is not None,
        "type": str(message.type),
        "content": message.content,
        "reply_to": str(reference) if reference else None,
        "attachments": [{"name": a.filename, "url": a.url} for a in message.attachments],
        "embeds": [e.title or e.description or "(embed)" for e in message.embeds],
        "thread": {"id": str(message.thread.id), "name": message.thread.name} if message.thread else None,
    }


def thread_info(thread):
    return {
        "id": str(thread.id),
        "name": thread.name,
        "parent": thread.parent.name if thread.parent else None,
        "archived": thread.archived,
        "created": thread.created_at.isoformat() if thread.created_at else None,
        "messages": thread.message_count,
    }


def parse_time(value, name):
    if not value:
        return None
    try:
        moment = datetime.datetime.fromisoformat(value)
    except ValueError:
        raise web.HTTPBadRequest(text=f"{name} must be an ISO date/time")
    return moment if moment.tzinfo else moment.replace(tzinfo=datetime.timezone.utc)


def bad_request(message):
    return web.json_response({"status": "error", "error": message}, status=400)


def build_embed(spec):
    """Turn a JSON embed spec into a discord.Embed, checking Discord's limits.

    Spec keys: title, url, description, color ("#rrggbb"), author, footer,
    thumbnail, image (URLs), timestamp (true = now), fields [{name, value, inline}].
    """
    data = {key: spec[key] for key in ("title", "url", "description") if spec.get(key)}
    color = spec.get("color")
    if color:
        data["color"] = int(str(color).lstrip("#"), 16)
    if spec.get("author"):
        data["author"] = {"name": spec["author"]}
    if spec.get("footer"):
        data["footer"] = {"text": spec["footer"]}
    for key in ("thumbnail", "image"):
        if spec.get(key):
            data[key] = {"url": spec[key]}
    if spec.get("timestamp"):
        data["timestamp"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    fields = spec.get("fields") or []
    data["fields"] = [
        {"name": f["name"], "value": f["value"], "inline": bool(f.get("inline"))} for f in fields
    ]

    problems = []
    for key in ("title", "description"):
        if len(data.get(key, "")) > EMBED_LIMITS[key]:
            problems.append(f"{key} is longer than {EMBED_LIMITS[key]} characters")
    if len(spec.get("footer") or "") > EMBED_LIMITS["footer"]:
        problems.append(f"footer is longer than {EMBED_LIMITS['footer']} characters")
    if len(spec.get("author") or "") > EMBED_LIMITS["author"]:
        problems.append(f"author is longer than {EMBED_LIMITS['author']} characters")
    if len(fields) > EMBED_LIMITS["fields"]:
        problems.append(f"more than {EMBED_LIMITS['fields']} fields")
    for f in fields:
        if not f.get("name") or not f.get("value"):
            problems.append("every field needs a name and a value")
        elif len(f["name"]) > EMBED_LIMITS["field_name"] or len(f["value"]) > EMBED_LIMITS["field_value"]:
            problems.append(f"field '{f['name'][:40]}' is too long")
    embed = discord.Embed.from_dict(data)
    if len(embed) > EMBED_LIMITS["total"]:
        problems.append(f"embed is longer than {EMBED_LIMITS['total']} characters in total")
    return embed, problems


# --- tarot readings ----------------------------------------------------------------

def load_poll(poll_id):
    path = POLLS / f"{poll_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def save_poll(poll):
    POLLS.mkdir(exist_ok=True)
    (POLLS / f"{poll['id']}.json").write_text(json.dumps(poll, indent=2, ensure_ascii=False), encoding="utf-8")


def poll_counts(poll):
    counts = [0, 0, 0]
    for vote in poll["votes"].values():
        counts[vote["position"]] += 1
    return counts


def card_title(index):
    return f"{tarot.ROMAN[index]} · {tarot.MAJOR_ARCANA[index]}"


class TarotCard(discord.ui.DynamicItem[discord.ui.Button], template=r"tarot:(?P<poll>[0-9a-f]+):(?P<pos>[0-2])"):
    """One of the three buttons under a reading. Survives bot restarts (dynamic item)."""

    def __init__(self, poll_id, position, disabled=False):
        super().__init__(discord.ui.Button(
            label=tarot.ROMAN[position + 1], style=discord.ButtonStyle.secondary,
            custom_id=f"tarot:{poll_id}:{position}", disabled=disabled))
        self.poll_id, self.position = poll_id, position

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["poll"], int(match["pos"]))

    async def callback(self, interaction):
        poll = load_poll(self.poll_id)
        if poll is None or poll["closed"]:
            await interaction.response.send_message("This reading is closed.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        index = poll["cards"][self.position]
        changed = str(interaction.user.id) in poll["votes"]
        poll["votes"][str(interaction.user.id)] = {
            "position": self.position, "name": interaction.user.display_name,
            "time": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        }
        save_poll(poll)

        loop = asyncio.get_running_loop()
        if poll.get("face_up"):  # everyone already sees the cards: no flip, just the chosen card
            image, name, verb = await loop.run_in_executor(None, tarot.chosen_png, index), "chosen.png", "chose"
        else:
            image, name, verb = await loop.run_in_executor(None, tarot.flip_gif, index), "flip.gif", "turned"
        embed = discord.Embed(
            title=f"You {verb} card {tarot.ROMAN[self.position + 1]}",
            description=(f"**{card_title(index)}**\n\n"
                         + ("Your choice has been changed. " if changed else "Your choice is recorded. ")
                         + "Only you can see this. Press another card to change it."),
            color=int("e0a85d", 16))
        embed.set_image(url=f"attachment://{name}")
        await interaction.followup.send(embed=embed, file=discord.File(io.BytesIO(image), name), ephemeral=True)

        # Public count only: never who chose what.
        if interaction.message and interaction.message.embeds:
            public = interaction.message.embeds[0]
            public.set_footer(text=poll_footer(poll))
            await interaction.message.edit(embed=public)


def poll_footer(poll, closed=False):
    votes = len(poll["votes"])
    host = f"Hosted by {poll['host_name']} · " if poll.get("host_name") else ""
    state = "reading closed" if closed else "choices are secret"
    if poll.get("face_up"):
        return f"{host}{votes} choice{'s' if votes != 1 else ''} made · {state}"
    return f"{host}{votes} card{'s' if votes != 1 else ''} turned · {state}"


def can_host(poll, member):
    """The person who dealt the reading, or anyone who can manage messages there."""
    if poll.get("host_id") == str(member.id):
        return True
    permissions = getattr(member, "guild_permissions", None)
    return bool(permissions and permissions.manage_messages)


def poll_report(poll):
    """The host's private view: cards, counts and who chose what."""
    counts = poll_counts(poll)
    lines = [f"**{poll['question']}**", ""]
    for position, index in enumerate(poll["cards"]):
        voters = [v["name"] for v in poll["votes"].values() if v["position"] == position]
        lines.append(f"**{tarot.ROMAN[position + 1]}** · {card_title(index)} · {counts[position]} "
                     f"vote{'s' if counts[position] != 1 else ''}" + (f"\n  ↳ {', '.join(voters)}" if voters else ""))
    return "\n".join(lines)


class TarotHost(discord.ui.DynamicItem[discord.ui.Button], template=r"tarot-host:(?P<poll>[0-9a-f]+)"):
    """'Host controls' under a reading: a private peek with a Reveal button, for the host only."""

    def __init__(self, poll_id, disabled=False):
        super().__init__(discord.ui.Button(
            label="Host controls", emoji="🔮", style=discord.ButtonStyle.primary,
            custom_id=f"tarot-host:{poll_id}", disabled=disabled))
        self.poll_id = poll_id

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["poll"])

    async def callback(self, interaction):
        poll = load_poll(self.poll_id)
        if poll is None or poll["closed"]:
            await interaction.response.send_message("This reading is closed.", ephemeral=True)
            return
        if not can_host(poll, interaction.user):
            await interaction.response.send_message("Only the person who dealt this reading can use this.", ephemeral=True)
            return
        controls = discord.ui.View(timeout=None)
        controls.add_item(TarotReveal(self.poll_id))
        embed = discord.Embed(title="🔮 Reading so far (only you can see this)",
                              description=poll_report(poll), color=int("7ad7d1", 16))
        await interaction.response.send_message(embed=embed, view=controls, ephemeral=True)


class TarotReveal(discord.ui.DynamicItem[discord.ui.Button], template=r"tarot-reveal:(?P<poll>[0-9a-f]+)"):
    """Ends a reading and shows the result to everyone (host only)."""

    def __init__(self, poll_id):
        super().__init__(discord.ui.Button(
            label="End and reveal", emoji="🏁", style=discord.ButtonStyle.danger,
            custom_id=f"tarot-reveal:{poll_id}"))
        self.poll_id = poll_id

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["poll"])

    async def callback(self, interaction):
        poll = load_poll(self.poll_id)
        if poll is None or poll["closed"]:
            await interaction.response.send_message("This reading is already closed.", ephemeral=True)
            return
        if not can_host(poll, interaction.user):
            await interaction.response.send_message("Only the person who dealt this reading can end it.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        message = await reveal_reading(interaction.client, poll)
        await interaction.followup.send(f"Revealed: {message.jump_url}", ephemeral=True)


def tarot_view(poll_id, disabled=False):
    view = discord.ui.View(timeout=None)
    for position in range(3):
        view.add_item(TarotCard(poll_id, position, disabled))
    host = TarotHost(poll_id, disabled)
    host.row = 1  # its own row, so the card buttons stay together
    view.add_item(host)
    return view


def missing_post_permissions(channel):
    perms = channel.permissions_for(channel.guild.me)
    return [name for name, ok in (("View Channel", perms.view_channel), ("Send Messages", perms.send_messages),
                                  ("Embed Links", perms.embed_links), ("Attach Files", perms.attach_files)) if not ok]


async def deal_reading(channel, question, description, cards, host, face_up=False):
    """Post a reading: three cards (face down unless face_up), the card buttons and the host button."""
    poll = {"id": secrets.token_hex(3), "question": question, "cards": cards, "votes": {},
            "closed": False, "face_up": bool(face_up), "channel_id": str(channel.id), "message_id": None,
            "host_id": str(host.id) if host else None, "host_name": host.display_name if host else None,
            "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    gif = await asyncio.get_running_loop().run_in_executor(None, tarot.deal_gif, cards if face_up else None)
    default = "Three cards lie face up. Choose one." if face_up else "Three cards lie face down. Choose one."
    embed = discord.Embed(title=f"🔮 {question}", description=description or default, color=int("e0a85d", 16))
    embed.set_image(url="attachment://table.gif")
    embed.set_footer(text=poll_footer(poll))
    message = await channel.send(embed=embed, file=discord.File(io.BytesIO(gif), "table.gif"),
                                 view=tarot_view(poll["id"]), allowed_mentions=discord.AllowedMentions.none())
    poll["message_id"] = str(message.id)
    save_poll(poll)
    return poll, message


async def reveal_reading(client, poll):
    """Turn the cards face up for everyone, with the counts; disable the buttons."""
    counts = poll_counts(poll)
    channel = client.get_channel(int(poll["channel_id"])) or await client.fetch_channel(int(poll["channel_id"]))
    message = await channel.fetch_message(int(poll["message_id"]))
    png = await asyncio.get_running_loop().run_in_executor(None, tarot.reveal_png, poll["cards"], counts)
    best = max(counts)
    winners = [card_title(poll["cards"][p]) for p in range(3) if counts[p] == best] if best else []
    embed = discord.Embed(
        title=f"🔮 {poll['question']}",
        description=("The cards are turned. " + (
            f"**{' and '.join(winners)}** {'was' if len(winners) == 1 else 'were'} chosen most."
            if winners else "Nobody chose a card.")),
        color=int("7ad7d1", 16))
    embed.set_image(url="attachment://reveal.png")
    embed.set_footer(text=poll_footer(poll, closed=True))
    await message.edit(embed=embed, attachments=[discord.File(io.BytesIO(png), "reveal.png")],
                       view=tarot_view(poll["id"], disabled=True))
    poll["closed"] = True
    save_poll(poll)
    print(f"Revealed reading {poll['id']}")
    return message


# --- terms & consent ---------------------------------------------------------------

def load_consent():
    return json.loads(CONSENT_FILE.read_text(encoding="utf-8")) if CONSENT_FILE.exists() else {}


def save_consent(consent):
    DATA.mkdir(exist_ok=True)
    CONSENT_FILE.write_text(json.dumps(consent, indent=2, ensure_ascii=False), encoding="utf-8")


def log_consent(entry):
    DATA.mkdir(exist_ok=True)
    with CONSENT_LOG.open("a", encoding="utf-8") as log:
        log.write(json.dumps(entry, ensure_ascii=False) + "\n")


CONSENT_BUTTONS = {
    "accept": ("Accept the terms", "✅", discord.ButtonStyle.success),
    "info": ("What does Vaulty read?", "📄", discord.ButtonStyle.secondary),
    "withdraw": ("Withdraw", "↩️", discord.ButtonStyle.secondary),
}


class ConsentButton(discord.ui.DynamicItem[discord.ui.Button], template=r"consent:(?P<verb>accept|info|withdraw)"):
    """The buttons under the terms. Accepting gives the roleplay role; withdrawing removes it."""

    def __init__(self, verb):
        label, emoji, style = CONSENT_BUTTONS[verb]
        super().__init__(discord.ui.Button(label=label, emoji=emoji, style=style, custom_id=f"consent:{verb}"))
        self.verb = verb

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["verb"])

    async def callback(self, interaction):
        consent = load_consent()
        role = interaction.guild.get_role(int(consent.get("role_id", 0))) if interaction.guild else None
        if role is None:
            await interaction.response.send_message("The terms aren't set up yet. Please tell a moderator.", ephemeral=True)
            return
        if self.verb == "info":
            embed = discord.Embed(title="📄 What Vaulty reads", description=consent.get("info", ""), color=int("7ad7d1", 16))
            await interaction.response.send_message(embed=embed, ephemeral=True)
            return

        member, user_id, version = interaction.user, str(interaction.user.id), consent.get("version", 1)
        accepted = consent.setdefault("accepted", {})
        now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        if self.verb == "accept":
            if role in member.roles and accepted.get(user_id, {}).get("version") == version:
                await interaction.response.send_message(f"You've already accepted version {version} of the terms.", ephemeral=True)
                return
            try:
                await member.add_roles(role, reason=f"Accepted the Nowhere Expeditions terms (v{version})")
            except discord.HTTPException:
                print(f"Couldn't give {member} the role {role.name}: check the bot's Manage Roles permission and role order.")
                await interaction.response.send_message(
                    "Your acceptance couldn't be completed: I wasn't able to give you the role. A moderator has been told.",
                    ephemeral=True)
                return
            accepted[user_id] = {"name": member.display_name, "version": version, "time": now}
            save_consent(consent)
            log_consent({"time": now, "action": "accept", "user_id": user_id, "name": member.display_name, "version": version})
            print(f"{member} accepted the terms (v{version}).")
            await interaction.response.send_message(
                f"✅ **Welcome aboard.** You accepted version {version} of the terms and now have the **{role.name}** role, "
                "which opens the roleplaying channels. You can withdraw at any time with the ↩️ button.", ephemeral=True)
        else:  # withdraw
            if role not in member.roles and user_id not in accepted:
                await interaction.response.send_message("You haven't accepted the terms, so there's nothing to withdraw.", ephemeral=True)
                return
            try:
                await member.remove_roles(role, reason="Withdrew from the Nowhere Expeditions terms")
            except discord.HTTPException:
                print(f"Couldn't remove {role.name} from {member}.")
            accepted.pop(user_id, None)
            save_consent(consent)
            log_consent({"time": now, "action": "withdraw", "user_id": user_id, "name": member.display_name, "version": version})
            print(f"NOTICE: {member} withdrew from the terms.")
            await interaction.response.send_message(
                "↩️ **Withdrawn.** You no longer have access to the roleplaying channels, and Vaulty won't use anything "
                "you post from now on. You can accept again any time.", ephemeral=True)


def consent_view():
    # "info" isn't posted any more (the terms already say it); its handler stays for older messages.
    view = discord.ui.View(timeout=None)
    for verb in ("accept", "withdraw"):
        view.add_item(ConsentButton(verb))
    return view


@discord.app_commands.command(name="accepted-terms", description="List everyone who has accepted the Nowhere Expeditions terms")
@discord.app_commands.guild_only()
async def accepted_terms_command(interaction: discord.Interaction):
    consent = load_consent()
    accepted = consent.get("accepted", {})
    role = interaction.guild.get_role(int(consent.get("role_id", 0))) if consent else None
    if not consent:
        await interaction.response.send_message("The terms haven't been posted yet.", ephemeral=True)
        return
    entries = sorted(accepted.items(), key=lambda item: item[1].get("time", ""))
    lines = []
    for user_id, entry in entries:
        day = entry.get("time", "")[:10]
        lines.append(f"<@{user_id}> · v{entry.get('version', '?')} · {day}")
    text = "\n".join(lines) or "Nobody yet."
    if len(text) > 4000:
        text = text[:4000].rsplit("\n", 1)[0] + "\n…"
    embed = discord.Embed(
        title=f"📜 Accepted the terms · {len(entries)}",
        description=text, color=int("7ad7d1", 16))
    embed.set_footer(text=f"Current terms: version {consent.get('version', '?')}"
                          + (f" · role: {role.name}" if role else ""))
    await interaction.response.send_message(embed=embed, ephemeral=True,
                                            allowed_mentions=discord.AllowedMentions.none())


# --- self-assigned roles (Join / Leave buttons) -----------------------------------------

SELF_ROLES = DATA / "self-roles.json"  # role id -> {name, join, leave}; written only by an approved post


def load_self_roles():
    return json.loads(SELF_ROLES.read_text(encoding="utf-8")) if SELF_ROLES.exists() else {}


def save_self_roles(roles):
    DATA.mkdir(exist_ok=True)
    SELF_ROLES.write_text(json.dumps(roles, indent=2, ensure_ascii=False), encoding="utf-8")


class RoleButton(discord.ui.DynamicItem[discord.ui.Button], template=r"role:(?P<verb>join|leave):(?P<role>\d+)"):
    """Join / Leave buttons for a self-assignable role. Only roles approved with a post work."""

    def __init__(self, verb, role_id, label=None):
        style = discord.ButtonStyle.success if verb == "join" else discord.ButtonStyle.secondary
        emoji = "🧭" if verb == "join" else "↩️"
        super().__init__(discord.ui.Button(label=label or verb.title(), emoji=emoji, style=style,
                                           custom_id=f"role:{verb}:{role_id}"))
        self.verb, self.role_id = verb, int(role_id)

    @classmethod
    async def from_custom_id(cls, interaction, item, match):
        return cls(match["verb"], match["role"], item.label)

    async def callback(self, interaction):
        entry = load_self_roles().get(str(self.role_id))
        role = interaction.guild.get_role(self.role_id) if interaction.guild else None
        if entry is None or role is None:
            await interaction.response.send_message("This button isn't active any more. Please tell a moderator.", ephemeral=True)
            return
        member = interaction.user
        try:
            if self.verb == "join":
                if role in member.roles:
                    await interaction.response.send_message(
                        entry.get("already") or f"You already have **{role.name}**.", ephemeral=True)
                    return
                await member.add_roles(role, reason="Self-assigned with a Vaulty button")
                print(f"{member} took the role {role.name}.")
                await interaction.response.send_message(entry["join"], ephemeral=True)
                if entry.get("welcome_channel_id"):
                    await send_welcome(interaction.guild, int(entry["welcome_channel_id"]), member)
            else:
                if role not in member.roles:
                    await interaction.response.send_message(f"You don't have **{role.name}**.", ephemeral=True)
                    return
                await member.remove_roles(role, reason="Removed with a Vaulty button")
                print(f"{member} left the role {role.name}.")
                await interaction.response.send_message(entry["leave"], ephemeral=True)
        except discord.HTTPException:
            print(f"Couldn't change {role.name} for {member}: check Manage Roles and role order.")
            await interaction.response.send_message("That didn't work. A moderator has been told.", ephemeral=True)


WELCOME_FILE = Path(__file__).with_name("welcome-messages.json")  # greetings + questions (edit freely)
WELCOMED = DATA / "welcomed.json"  # user id -> time: each person is greeted once


async def send_welcome(guild, channel_id, member):
    """Greet a new member once, with a random greeting and a question for everyone."""
    welcomed = json.loads(WELCOMED.read_text(encoding="utf-8")) if WELCOMED.exists() else {}
    if str(member.id) in welcomed:
        return
    channel = guild.get_channel(channel_id)
    if channel is None or not WELCOME_FILE.exists():
        return
    pool = json.loads(WELCOME_FILE.read_text(encoding="utf-8"))
    greeting = random.choice(pool["greetings"]).replace("{member}", member.mention)
    closing = pool.get("closing", "{question}").replace("{question}", random.choice(pool["questions"]))
    try:
        await channel.send(f"{greeting}\n{closing}", allowed_mentions=discord.AllowedMentions(users=[member]))
    except discord.HTTPException:
        print(f"Couldn't welcome {member} in #{channel.name}: check Vaulty's access there.")
        return
    welcomed[str(member.id)] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    DATA.mkdir(exist_ok=True)
    WELCOMED.write_text(json.dumps(welcomed, indent=2), encoding="utf-8")
    print(f"Welcomed {member} in #{channel.name}.")


def role_view(role_id, join_label, leave_label):
    view = discord.ui.View(timeout=None)
    view.add_item(RoleButton("join", role_id, join_label))
    view.add_item(RoleButton("leave", role_id, leave_label))
    return view


# --- channel structure -------------------------------------------------------------

PERMISSIONS = {"view": "view_channel", "send": "send_messages", "history": "read_message_history",
               "threads": "create_public_threads", "thread_send": "send_messages_in_threads",
               "react": "add_reactions", "embed": "embed_links", "attach": "attach_files"}
BOT_ACCESS = {"view_channel": True, "send_messages": True, "read_message_history": True, "embed_links": True,
              "attach_files": True, "send_messages_in_threads": True, "manage_threads": True}


def bot_access(guild):
    """Vaulty's own access in channels it creates, limited to what it has server-wide:
    Discord refuses overwrites that grant permissions the bot doesn't hold itself."""
    have = guild.me.guild_permissions
    return {key: True for key in BOT_ACCESS if getattr(have, key) or have.administrator}


def permissions_missing(guild, spec):
    """Permission keys the spec's overwrites (and read-only channels) use that Vaulty lacks."""
    used = set()
    for category in spec.get("categories", []):
        for perms in (category.get("overwrites") or {}).values():
            used |= {PERMISSIONS[key] for key in perms}
        for channel in category.get("channels", []):
            for perms in (channel.get("overwrites") or {}).values():
                used |= {PERMISSIONS[key] for key in perms}
            if channel.get("read_only"):
                used |= {"send_messages", "create_public_threads", "send_messages_in_threads", "add_reactions"}
    have = guild.me.guild_permissions
    return sorted(p for p in used if not (getattr(have, p) or have.administrator))


def resolve_target(guild, name):
    if name == "@everyone":
        return guild.default_role
    return discord.utils.get(guild.roles, name=name)


def merged_overwrites(guild, base, spec):
    """base (existing overwrites) updated with spec {"Role name": {"view": true, "send": false}}."""
    result = {target: discord.PermissionOverwrite(**dict(overwrite)) for target, overwrite in base.items()}
    for name, perms in (spec or {}).items():
        target = resolve_target(guild, name)
        overwrite = result.get(target, discord.PermissionOverwrite())
        overwrite.update(**{PERMISSIONS[key]: value for key, value in perms.items()})
        result[target] = overwrite
    return result


def make_read_only(guild, overwrites):
    """Everyone who can see the channel can read but not post; the bot can still post."""
    overwrites = dict(overwrites)
    everyone = overwrites.get(guild.default_role, discord.PermissionOverwrite())
    everyone.update(send_messages=False, create_public_threads=False, send_messages_in_threads=False, add_reactions=False)
    overwrites[guild.default_role] = everyone
    for target, overwrite in list(overwrites.items()):
        if target not in (guild.me, guild.default_role) and overwrite.view_channel:
            overwrite.update(send_messages=False, create_public_threads=False, send_messages_in_threads=False)
    return overwrites


def describe_access(overwrites):
    parts = []
    for target, overwrite in overwrites.items():
        allow, deny = overwrite.pair()
        name = getattr(target, "name", str(target))
        bits = [f"+{k}" for k, v in PERMISSIONS.items() if getattr(allow, v)] + \
               [f"-{k}" for k, v in PERMISSIONS.items() if getattr(deny, v)]
        if bits:
            parts.append(f"{name} {' '.join(bits)}")
    return "; ".join(parts) or "same as category"


async def cancel_reading(client, poll):
    """Close a reading without revealing it: cards stay hidden, buttons are disabled."""
    channel = client.get_channel(int(poll["channel_id"])) or await client.fetch_channel(int(poll["channel_id"]))
    message = await channel.fetch_message(int(poll["message_id"]))
    poll["closed"] = True
    poll["cancelled"] = True
    if message.embeds:
        embed = message.embeds[0]
        embed.description = "This reading was cancelled before the cards were revealed."
        embed.set_footer(text=poll_footer(poll, closed=True))
        await message.edit(embed=embed, view=tarot_view(poll["id"], disabled=True))
    else:
        await message.edit(view=tarot_view(poll["id"], disabled=True))
    save_poll(poll)
    print(f"Cancelled reading {poll['id']}")
    return message


@discord.app_commands.command(name="tarot", description="Deal three face-down tarot cards as a secret choice")
@discord.app_commands.describe(question="What the cards are asked",
                               text="Optional text under the question",
                               cards="Optional: three card numbers 0-21, e.g. 0,16,17 (random if empty)",
                               face_up="Deal the cards face up, so everyone sees them before choosing")
@discord.app_commands.default_permissions(manage_messages=True)
@discord.app_commands.guild_only()
async def tarot_command(interaction: discord.Interaction, question: str, text: str = None, cards: str = None,
                        face_up: bool = False):
    channel = interaction.channel
    missing = missing_post_permissions(channel)
    if missing:
        await interaction.response.send_message(f"I can't deal here: I'm missing {', '.join(missing)}.", ephemeral=True)
        return
    try:
        chosen = [int(c) for c in cards.split(",")] if cards else random.sample(range(len(tarot.MAJOR_ARCANA)), 3)
    except ValueError:
        chosen = []
    if len(chosen) != 3 or len(set(chosen)) != 3 or not all(0 <= c < len(tarot.MAJOR_ARCANA) for c in chosen):
        await interaction.response.send_message("Cards must be three different numbers from 0 to 21.", ephemeral=True)
        return
    await interaction.response.defer(ephemeral=True, thinking=True)
    poll, message = await deal_reading(channel, question[:250], text, chosen, interaction.user, face_up)
    print(f"{interaction.user} dealt reading {poll['id']} in #{channel.name}")
    await interaction.followup.send(
        "Dealt. Use **🔮 Host controls** under the reading to peek at the choices or end it.\n"
        "Cards (only you can see this): " + " | ".join(
            f"{tarot.ROMAN[p + 1]}: {card_title(c)}" for p, c in enumerate(chosen)),
        ephemeral=True)


def names_embed(faction, gender, count):
    label, note = namegen.describe(faction)
    listed = namegen.generate(faction, gender, count)
    embed = discord.Embed(title=f"🧭 Names from the {label}" if faction != "verna" else "🧭 Names from Verna",
                          description="\n".join(f"{i}. {name}" for i, name in enumerate(listed, 1)),
                          color=int("7ad7d1", 16))
    if note:
        embed.set_footer(text=note.replace("*", ""))
    return embed


class NamesAgain(discord.ui.View):
    """'Ten more' under a private /names reply. Not persistent: it stops working after 15 minutes."""

    def __init__(self, faction, gender, count):
        super().__init__(timeout=900)
        self.faction, self.gender, self.count = faction, gender, count

    @discord.ui.button(label="More names", emoji="🎲", style=discord.ButtonStyle.secondary)
    async def again(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.edit_message(embed=names_embed(self.faction, self.gender, self.count), view=self)


@discord.app_commands.command(name="names", description="Suggest character names in the style of a faction")
@discord.app_commands.describe(origin="Where your character comes from",
                               style="Feminine or masculine names (mixed if empty)",
                               count="How many names, 1-10 (default 10)")
@discord.app_commands.choices(
    origin=[discord.app_commands.Choice(name=label, value=faction) for faction, label in (
        ("vardic-holds", "Vardic Holds"), ("aurelian-empire", "Aurelian Empire"),
        ("vesper-republic", "Vesper Republic"), ("kharad-compact", "Kharad Compact"),
        ("tianzhao-mandate", "Tianzhao Mandate"), ("verna", "Verna"))],
    style=[discord.app_commands.Choice(name="Feminine", value="feminine"),
           discord.app_commands.Choice(name="Masculine", value="masculine")])
async def names_command(interaction: discord.Interaction, origin: str, style: str = None,
                        count: discord.app_commands.Range[int, 1, 10] = 10):
    # Private reply: only the person asking sees the list, so it never clutters a channel.
    await interaction.response.send_message(embed=names_embed(origin, style, count),
                                            view=NamesAgain(origin, style, count), ephemeral=True)


class Vaultulation(discord.Client):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.tree = discord.app_commands.CommandTree(self)
        self.tree.add_command(tarot_command)
        self.tree.add_command(accepted_terms_command)
        self.tree.add_command(names_command)

    async def setup_hook(self):
        self.pending = {}  # approval id -> {"title", "lines", "created", "future"}
        self.next_pending = 1
        self.started = datetime.datetime.now(datetime.timezone.utc)
        # Terminal answers ("y", "n", "y 3", "n 3") are read on a background thread.
        loop = asyncio.get_running_loop()
        threading.Thread(target=self.read_terminal, args=(loop,), daemon=True).start()
        await self.start_dashboard()
        self.add_dynamic_items(TarotCard, TarotHost, TarotReveal, ConsentButton, RoleButton)
        app = web.Application(middlewares=[self.api_errors])
        app.add_routes([
            web.get("/status", self.api_status),
            web.get("/guilds", self.api_guilds),
            web.get("/guilds/{guild_id}/channels", self.api_channels),
            web.get("/guilds/{guild_id}/roles", self.api_roles),
            web.get("/threads", self.api_threads),
            web.get("/read", self.api_read),
            web.post("/actions/post-embed", self.action_post_embed),
            web.post("/actions/delete-message", self.action_delete_message),
            web.get("/tarot/{poll_id}", self.api_tarot),
            web.post("/actions/tarot-deal", self.action_tarot_deal),
            web.post("/actions/tarot-reveal", self.action_tarot_reveal),
            web.post("/actions/create-role", self.action_create_role),
            web.post("/actions/post-terms", self.action_post_terms),
            web.post("/actions/apply-structure", self.action_apply_structure),
            web.get("/consent", self.api_consent),
        ])
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, HOST, PORT).start()
        print(f"Local API listening on http://{HOST}:{PORT} (writes need your approval: here or in the dashboard)")

    async def on_ready(self):
        names = ", ".join(guild.name for guild in self.guilds) or "no servers yet"
        print(f"Logged in as {self.user} · servers: {names}")
        # Register slash commands per server (shows up immediately, unlike global sync).
        for guild in self.guilds:
            self.tree.copy_global_to(guild=guild)
            try:
                synced = await self.tree.sync(guild=guild)
                print(f"Slash commands ready in {guild.name}: {', '.join('/' + c.name for c in synced)}")
            except discord.HTTPException as error:
                print(f"Couldn't register slash commands in {guild.name}: {error.text}")

    # --- helpers -----------------------------------------------------------

    def guild_or_404(self, request):
        guild_id = request.match_info["guild_id"]
        guild = self.get_guild(int(guild_id)) if guild_id.isdigit() else None
        if guild is None:
            raise web.HTTPNotFound(text="Unknown server id")
        return guild

    def find_text_channel(self, ref, guild_id=None):
        """A text or announcement channel by id or by name (without #)."""
        guilds = [self.get_guild(int(guild_id))] if guild_id else self.guilds
        ref = str(ref).lstrip("#")
        for guild in filter(None, guilds):
            for channel in guild.text_channels:
                if str(channel.id) == ref or channel.name == ref:
                    return channel
        return None

    async def find_readable(self, ref):
        """A text channel, forum or thread (active or archived) by id or name."""
        ref = str(ref).lstrip("#")
        for guild in self.guilds:
            for channel in [*guild.text_channels, *guild.forums, *guild.threads]:
                if str(channel.id) == ref or channel.name == ref:
                    return channel
        if ref.isdigit():  # e.g. an archived thread, which isn't cached
            try:
                return await self.fetch_channel(int(ref))
            except (discord.NotFound, discord.Forbidden):
                return None
        return None

    async def all_threads(self, channel):
        """Active and archived threads of a text channel or forum."""
        threads = {t.id: t for t in getattr(channel, "threads", [])}
        try:
            async for thread in channel.archived_threads(limit=None):
                threads[thread.id] = thread
        except discord.Forbidden:
            pass  # private archived threads need Manage Threads
        return sorted(threads.values(), key=lambda t: t.created_at or datetime.datetime.min.replace(tzinfo=datetime.timezone.utc))

    async def ask_gm(self, title, lines):
        """Queue an action for the GM's approval and wait for the answer, given either in this
        terminal or in the dashboard. Unanswered requests are rejected after APPROVAL_TIMEOUT."""
        approval_id = self.next_pending
        self.next_pending += 1
        future = asyncio.get_running_loop().create_future()
        self.pending[approval_id] = {"title": title, "lines": lines, "future": future,
                                     "created": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
        print("\n" + "=" * 64)
        print(f"APPROVAL NEEDED #{approval_id} · {title}")
        for line in lines:
            print(f"  {line}")
        print("=" * 64)
        print(f"Type y or n (or 'y {approval_id}' / 'n {approval_id}'), or answer in the dashboard.")
        caption = f"Vaultulation · approval #{approval_id}"
        if DIALOGS:
            loop = asyncio.get_running_loop()
            text = title + "\n\n" + "\n".join(lines) + "\n\nApprove this?"

            def show_dialog():
                approved = windows_yes_no(caption, text)
                loop.call_soon_threadsafe(self.answer_pending, approval_id, approved, "dialog")

            threading.Thread(target=show_dialog, daemon=True).start()
        try:
            return await asyncio.wait_for(future, APPROVAL_TIMEOUT)
        except asyncio.TimeoutError:
            print(f"#{approval_id} timed out: rejected.")
            return False
        finally:
            self.pending.pop(approval_id, None)
            if DIALOGS:
                close_windows_dialog(caption)  # answered elsewhere (or timed out): close the box

    def answer_pending(self, approval_id, approved, via):
        entry = self.pending.get(approval_id)
        if entry is None or entry["future"].done():
            return False
        entry["future"].set_result(approved)
        print(f"#{approval_id} {'approved' if approved else 'rejected'} ({via}).")
        return True

    def read_terminal(self, loop):
        """Background thread: each line typed in the bot's terminal is an answer."""
        for line in sys.stdin:
            loop.call_soon_threadsafe(self.on_terminal_line, line.strip().lower())

    def on_terminal_line(self, line):
        if not line:
            return
        parts = line.split()
        approved = parts[0] in {"y", "yes"}
        if not approved and parts[0] not in {"n", "no"}:
            print("Answer with y or n, optionally followed by the request number.")
            return
        if len(parts) > 1 and parts[1].lstrip("#").isdigit():
            target = int(parts[1].lstrip("#"))
        elif self.pending:
            target = min(self.pending)  # the oldest waiting request
        else:
            print("Nothing is waiting for approval.")
            return
        if not self.answer_pending(target, approved, "terminal"):
            print(f"No request #{target} is waiting.")

    # --- dashboard (GM only: needs the key printed in this terminal) -------

    async def start_dashboard(self):
        # From run_bot.py (survives restarts) or made here. In memory only; never saved or logged.
        self.dashboard_key = os.environ.get("VAULTULATION_DASHBOARD_KEY") or secrets.token_urlsafe(24)
        self.exit_code = 0
        app = web.Application(middlewares=[self.dashboard_guard])
        app.add_routes([
            web.get("/", self.dashboard_page),
            web.get("/api/state", self.dashboard_state),
            web.post("/api/pending/{approval_id}", self.dashboard_answer),
            web.post("/api/polls/{poll_id}/{verb}", self.dashboard_poll),
            web.post("/api/bot/{verb}", self.dashboard_bot),
        ])
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, HOST, DASHBOARD_PORT).start()
        link = f"http://{HOST}:{DASHBOARD_PORT}/#key={self.dashboard_key}"
        print(f"Dashboard: {link}")
        print("  (this link is your key: keep it to yourself and don't paste it into a chat)")
        if OPEN_DASHBOARD:
            webbrowser.open(link)

    async def dashboard_bot(self, request):
        verb = request.match_info["verb"]
        if verb not in {"restart", "stop"}:
            return web.json_response({"error": "Unknown action"}, status=400)
        asyncio.get_running_loop().create_task(self.shutdown(restart=verb == "restart"))
        return web.json_response({"ok": True, "supervised": SUPERVISED})

    async def shutdown(self, restart):
        """Stop (or restart) the bot. Waiting approvals are rejected first."""
        await asyncio.sleep(0.5)  # let the dashboard's request finish
        for approval_id in list(self.pending):
            self.answer_pending(approval_id, False, "bot shutting down")
        print("Restarting..." if restart else "Stopping...")
        self.exit_code = RESTART_CODE if restart and SUPERVISED else 0
        self.respawn = restart and not SUPERVISED  # handled in main() once this copy has shut down
        await self.close()

    @web.middleware
    async def api_errors(self, request, handler):
        """Unexpected errors come back to ask.py with their message instead of a bare 500."""
        try:
            return await handler(request)
        except web.HTTPException:
            raise
        except Exception as error:  # noqa: BLE001 - report anything to the caller
            import traceback
            traceback.print_exc()
            return web.json_response({"status": "error", "error": f"{type(error).__name__}: {error}"}, status=500)

    @web.middleware
    async def dashboard_guard(self, request, handler):
        if request.path.startswith("/api/"):
            given = request.headers.get("X-Dashboard-Key", "")
            if not hmac.compare_digest(given, self.dashboard_key):
                return web.json_response({"error": "Missing or wrong dashboard key"}, status=403)
        return await handler(request)

    async def dashboard_page(self, request):
        return web.FileResponse(DASHBOARD_HTML)

    def poll_summary(self, poll):
        counts = poll_counts(poll)
        channel = self.get_channel(int(poll["channel_id"]))
        guild_id = channel.guild.id if channel else None
        url = (f"https://discord.com/channels/{guild_id}/{poll['channel_id']}/{poll['message_id']}"
               if guild_id and poll.get("message_id") else None)
        return {
            "id": poll["id"], "question": poll["question"], "created": poll.get("created"),
            "channel": f"#{channel.name}" if channel else poll["channel_id"], "url": url,
            "host": poll.get("host_name") or "dealt from a Claude session",
            "face_up": poll.get("face_up", False), "closed": poll["closed"], "cancelled": poll.get("cancelled", False),
            "cards": [{"position": tarot.ROMAN[p + 1], "name": card_title(c), "votes": counts[p],
                       "voters": [v["name"] for v in poll["votes"].values() if v["position"] == p]}
                      for p, c in enumerate(poll["cards"])],
            "total": sum(counts),
        }

    async def dashboard_state(self, request):
        polls = []
        if POLLS.exists():
            for path in POLLS.glob("*.json"):
                try:
                    polls.append(self.poll_summary(json.loads(path.read_text(encoding="utf-8"))))
                except (ValueError, KeyError):
                    continue
        polls.sort(key=lambda p: p["created"] or "", reverse=True)  # newest first
        polls = [p for p in polls if not p["closed"]] + [p for p in polls if p["closed"]]  # open ones on top
        log = ACTIONS_LOG.read_text(encoding="utf-8").splitlines()[-60:] if ACTIONS_LOG.exists() else []
        return web.json_response({
            "bot": {"user": str(self.user) if self.user else None, "ready": self.is_ready(),
                    "guilds": [g.name for g in self.guilds], "started": self.started.isoformat(timespec="seconds")},
            "pending": [{"id": i, "title": e["title"], "lines": e["lines"], "created": e["created"]}
                        for i, e in sorted(self.pending.items())],
            "polls": polls,
            "log": log,
        })

    async def dashboard_answer(self, request):
        body = await request.json()
        approval_id = int(request.match_info["approval_id"])
        if not self.answer_pending(approval_id, body.get("decision") == "approve", "dashboard"):
            return web.json_response({"error": "That request is no longer waiting"}, status=404)
        return web.json_response({"ok": True})

    async def dashboard_poll(self, request):
        poll = load_poll(request.match_info["poll_id"])
        verb = request.match_info["verb"]
        if poll is None:
            return web.json_response({"error": "No such reading"}, status=404)
        if poll["closed"]:
            return web.json_response({"error": "That reading is already closed"}, status=409)
        if verb == "reveal":
            message = await reveal_reading(self, poll)
        elif verb == "cancel":
            message = await cancel_reading(self, poll)
        else:
            return web.json_response({"error": "Unknown action"}, status=400)
        self.log_action(f"Dashboard: {verb} tarot reading {poll['id']}", [f"Question: {poll['question']}"],
                        "done", message.jump_url)
        return web.json_response({"ok": True, "url": message.jump_url})

    def log_action(self, title, lines, decision, result=""):
        stamp = datetime.datetime.now().isoformat(timespec="seconds")
        with ACTIONS_LOG.open("a", encoding="utf-8") as log:
            log.write(f"{stamp} | {decision.upper()} | {title}\n")
            for line in lines:
                log.write(f"    {line}\n")
            if result:
                log.write(f"    -> {result}\n")

    # --- read endpoints ----------------------------------------------------

    async def api_status(self, request):
        return web.json_response({
            "ready": self.is_ready(),
            "user": str(self.user) if self.user else None,
            "guilds": len(self.guilds),
        })

    async def api_guilds(self, request):
        return web.json_response([
            {"id": str(guild.id), "name": guild.name, "members": guild.member_count}
            for guild in self.guilds
        ])

    async def api_channels(self, request):
        guild = self.guild_or_404(request)
        channels = sorted(
            guild.channels,
            key=lambda c: (c.category.position if getattr(c, "category", None) else -1, c.position),
        )
        return web.json_response([channel_info(channel) for channel in channels])

    async def api_roles(self, request):
        guild = self.guild_or_404(request)
        roles = sorted(guild.roles, key=lambda r: r.position, reverse=True)
        return web.json_response([role_info(role) for role in roles])

    async def api_threads(self, request):
        channel = await self.find_readable(request.query.get("channel", ""))
        if channel is None or isinstance(channel, discord.Thread):
            raise web.HTTPNotFound(text="No text channel or forum with that name or id")
        threads = await self.all_threads(channel)
        return web.json_response({"channel": channel.name, "threads": [thread_info(t) for t in threads]})

    async def api_read(self, request):
        """Messages of one channel or thread between two times, oldest first."""
        channel = await self.find_readable(request.query.get("channel", ""))
        if channel is None:
            raise web.HTTPNotFound(text="No readable channel or thread with that name or id")
        if isinstance(channel, discord.ForumChannel):
            raise web.HTTPBadRequest(text="A forum has no messages of its own: list its posts with /threads, then read a post by id")
        perms = channel.permissions_for(channel.guild.me)
        if not (perms.view_channel and perms.read_message_history):
            raise web.HTTPForbidden(text=f"Vaultulation can't read the history of #{channel.name}")
        after = parse_time(request.query.get("after"), "after")
        before = parse_time(request.query.get("before"), "before")
        limit = min(int(request.query.get("limit", MAX_READ)), MAX_READ)

        messages = [message_info(m) async for m in
                    channel.history(limit=limit + 1, after=after, before=before, oldest_first=True)]
        truncated = len(messages) > limit
        print(f"Read {min(len(messages), limit)} messages from #{channel.name}")
        return web.json_response({
            "channel": {"id": str(channel.id), "name": channel.name,
                        "thread": isinstance(channel, discord.Thread),
                        "parent": channel.parent.name if isinstance(channel, discord.Thread) and channel.parent else None},
            "messages": messages[:limit],
            "truncated": truncated,
        })

    # --- write actions (always approved in the terminal first) -------------

    async def action_post_embed(self, request):
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return bad_request("Body must be JSON")

        channel = self.find_text_channel(body.get("channel", ""), body.get("guild"))
        if channel is None:
            return bad_request(f"No text channel called or with id '{body.get('channel')}'")
        perms = channel.permissions_for(channel.guild.me)
        missing = [name for name, ok in (("View Channel", perms.view_channel),
                                         ("Send Messages", perms.send_messages),
                                         ("Embed Links", perms.embed_links)) if not ok]
        if missing:
            return web.json_response(
                {"status": "error", "error": f"Vaultulation lacks {', '.join(missing)} in #{channel.name}"},
                status=403,
            )

        try:
            embed, problems = build_embed(body.get("embed") or {})
        except (KeyError, TypeError, ValueError) as error:
            return bad_request(f"Malformed embed: {error}")
        if problems:
            return bad_request("; ".join(problems))
        content = body.get("content") or None
        guild = channel.guild

        # Optional pings: "@everyone" and/or role names. Off unless the file asks for them.
        ping_everyone, ping_roles = False, []
        for name in body.get("ping") or []:
            if name == "@everyone":
                ping_everyone = True
            else:
                role = discord.utils.get(guild.roles, name=name)
                if role is None:
                    return bad_request(f"Can't ping unknown role '{name}'")
                ping_roles.append(role)
        if (ping_everyone or any(not r.mentionable for r in ping_roles)) and not perms.mention_everyone:
            return web.json_response({"status": "error", "error":
                f"Vaulty lacks Mention @everyone, @here and All Roles in #{channel.name}"}, status=403)
        mentions = (["@everyone"] if ping_everyone else []) + [r.mention for r in ping_roles]
        if mentions:
            content = " ".join(mentions) + ("\n" + content if content else "")

        # Optional self-role buttons: {"role": "Expeditioner", "join": "...", "leave": "...", messages}.
        role_button = body.get("role_button")
        button_role = None
        if role_button:
            button_role = discord.utils.get(guild.roles, name=role_button.get("role", ""))
            if button_role is None:
                return bad_request(f"No role '{role_button.get('role')}' for the buttons")
            if not guild.me.guild_permissions.manage_roles or button_role >= guild.me.top_role:
                return web.json_response({"status": "error", "error":
                    f"Vaulty can't hand out '{button_role.name}': it needs Manage Roles and a role above it"}, status=403)
        welcome_channel = None
        if role_button and role_button.get("welcome_channel"):
            welcome_channel = self.find_text_channel(role_button["welcome_channel"])
            if welcome_channel is None:
                return bad_request(f"No welcome channel '{role_button['welcome_channel']}'")
            here = welcome_channel.permissions_for(guild.me)
            if not (here.view_channel and here.send_messages):
                return web.json_response({"status": "error", "error":
                    f"Vaulty can't post in #{welcome_channel.name}: give it View Channel and Send Messages there"}, status=403)

        title = f"Post an embed in #{channel.name}"
        category = channel.category.name if channel.category else "no category"
        lines = [f"Channel: #{channel.name} ({category})"]
        if content:
            lines.append(f"Text above it: {content[:200]}")
        lines.append(f"Title: {embed.title or '-'}")
        if embed.description:
            preview = embed.description.replace("\n", " ")
            lines.append(f"Description: {preview[:200]}{'...' if len(preview) > 200 else ''}")
        if embed.fields:
            lines.append("Fields: " + " | ".join(f.name for f in embed.fields))
        if embed.footer and embed.footer.text:
            lines.append(f"Footer: {embed.footer.text}")
        if button_role:
            lines.append(f"Buttons: '{role_button.get('join')}' gives {button_role.name}; "
                         f"'{role_button.get('leave')}' removes it (anyone can use them)")
        if welcome_channel:
            lines.append(f"New members who join are greeted once in #{welcome_channel.name} "
                         "(random greeting + question from welcome-messages.json, pings only the newcomer)")
        if ping_everyone:
            lines.append(f"⚠️ PINGS @everyone: all {guild.member_count} members get a notification")
        if ping_roles:
            lines.append("⚠️ PINGS " + ", ".join(f"@{r.name} ({len(r.members) or '?'} members)" for r in ping_roles))
        if not mentions:
            lines.append("Mentions are disabled: nobody gets pinged.")

        if not await self.ask_gm(title, lines):
            self.log_action(title, lines, "rejected")
            print("Rejected.")
            return web.json_response({"status": "rejected"})

        view = None
        if button_role:
            roles = load_self_roles()
            roles[str(button_role.id)] = {
                "name": button_role.name,
                "join": role_button.get("join_message", f"You now have the **{button_role.name}** role."),
                "leave": role_button.get("leave_message", f"The **{button_role.name}** role has been removed."),
                "already": role_button.get("already_message"),
                "welcome_channel_id": str(welcome_channel.id) if welcome_channel else None,
            }
            save_self_roles(roles)
            view = role_view(button_role.id, role_button.get("join", "Join"), role_button.get("leave", "Leave"))
        try:
            message = await channel.send(
                content=content, embed=embed, view=view,
                allowed_mentions=discord.AllowedMentions(everyone=ping_everyone, roles=ping_roles, users=False))
        except discord.HTTPException as error:
            self.log_action(title, lines, "failed", error.text)
            print(f"Discord refused: {error.text}")
            return web.json_response({"status": "error", "error": f"Discord refused: {error.text}"}, status=502)

        self.log_action(title, lines, "approved", message.jump_url)
        print(f"Posted: {message.jump_url}")
        return web.json_response({"status": "posted", "message_id": str(message.id), "url": message.jump_url})

    async def action_delete_message(self, request):
        """Delete one of Vaulty's own messages (never anyone else's)."""
        body = await request.json()
        channel = await self.find_readable(body.get("channel", ""))
        if channel is None or not str(body.get("message_id", "")).isdigit():
            return bad_request("Needs a channel and a message_id")
        try:
            message = await channel.fetch_message(int(body["message_id"]))
        except discord.NotFound:
            return bad_request("No such message in that channel")
        if message.author.id != self.user.id:
            return web.json_response({"status": "error", "error": "Vaulty only deletes its own messages"}, status=403)
        title = f"Delete a Vaulty message in #{channel.name}"
        first = message.embeds[0].title if message.embeds else (message.content or "")[:80]
        lines = [f"Message: {message.jump_url}", f"Posted: {message.created_at:%Y-%m-%d %H:%M} UTC",
                 f"Starts with: {first}"]
        if not await self.ask_gm(title, lines):
            self.log_action(title, lines, "rejected")
            return web.json_response({"status": "rejected"})
        await message.delete()
        self.log_action(title, lines, "approved", "deleted")
        return web.json_response({"status": "deleted"})

    # --- tarot readings --------------------------------------------------------

    async def api_tarot(self, request):
        """GM view of a reading: cards, counts and who chose what."""
        poll = load_poll(request.match_info["poll_id"])
        if poll is None:
            raise web.HTTPNotFound(text="No reading with that id")
        return web.json_response({**poll, "counts": poll_counts(poll),
                                  "card_names": [card_title(i) for i in poll["cards"]]})

    async def action_tarot_deal(self, request):
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return bad_request("Body must be JSON")
        channel = self.find_text_channel(body.get("channel", ""), body.get("guild"))
        if channel is None:
            return bad_request(f"No text channel called or with id '{body.get('channel')}'")
        missing = missing_post_permissions(channel)
        if missing:
            return web.json_response(
                {"status": "error", "error": f"Vaultulation lacks {', '.join(missing)} in #{channel.name}"}, status=403)
        question = (body.get("question") or "").strip()
        if not question or len(question) > 256:
            return bad_request("A question of 1-256 characters is required")
        cards = body.get("cards") or random.sample(range(len(tarot.MAJOR_ARCANA)), 3)
        if len(cards) != 3 or len(set(cards)) != 3 or not all(0 <= c < len(tarot.MAJOR_ARCANA) for c in cards):
            return bad_request("cards must be three different numbers from 0 to 21")
        description = (body.get("description") or "").strip()

        title = f"Deal a tarot reading in #{channel.name}"
        lines = [f"Question: {question}"]
        if description:
            lines.append(f"Text: {description[:200]}")
        face_up = bool(body.get("face_up"))
        lines.append(("Cards (face UP, everyone sees them): " if face_up else "Cards (face down, GM only): ") + " | ".join(
            f"{tarot.ROMAN[p + 1]}: {card_title(c)}" for p, c in enumerate(cards)))
        if not await self.ask_gm(title, lines):
            self.log_action(title, lines, "rejected")
            print("Rejected.")
            return web.json_response({"status": "rejected"})

        try:
            # Dealt from a Claude session: no Discord host, so moderators control it.
            poll, message = await deal_reading(channel, question, description, cards, host=None, face_up=face_up)
        except discord.HTTPException as error:
            self.log_action(title, lines, "failed", error.text)
            return web.json_response({"status": "error", "error": f"Discord refused: {error.text}"}, status=502)
        self.log_action(title, lines, "approved", f"{message.jump_url} (reading {poll['id']})")
        print(f"Dealt reading {poll['id']}: {message.jump_url}")
        return web.json_response({"status": "posted", "poll": poll["id"], "url": message.jump_url})

    async def action_tarot_reveal(self, request):
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return bad_request("Body must be JSON")
        poll = load_poll(str(body.get("poll", "")))
        if poll is None:
            return bad_request("No reading with that id")
        if poll["closed"]:
            return bad_request("That reading is already revealed")
        counts = poll_counts(poll)
        title = f"Reveal tarot reading {poll['id']}"
        lines = [f"Question: {poll['question']}"] + [
            f"{tarot.ROMAN[p + 1]}: {card_title(c)} · {counts[p]} vote(s)" for p, c in enumerate(poll["cards"])]
        lines.append("The cards are turned face up for everyone; voters stay secret.")
        if not await self.ask_gm(title, lines):
            self.log_action(title, lines, "rejected")
            return web.json_response({"status": "rejected"})

        message = await reveal_reading(self, poll)
        self.log_action(title, lines, "approved", message.jump_url)
        return web.json_response({"status": "revealed", "counts": counts, "url": message.jump_url})

    # --- roles, terms and channel structure -----------------------------------

    def only_guild(self):
        return self.guilds[0] if len(self.guilds) == 1 else None

    async def api_consent(self, request):
        """Who accepted which version (read-only; for the GM)."""
        consent = load_consent()
        guild = self.only_guild()
        role = guild.get_role(int(consent.get("role_id", 0))) if guild and consent else None
        return web.json_response({"role": role.name if role else None, "version": consent.get("version"),
                                  "accepted": consent.get("accepted", {}), "posts": consent.get("posts", [])})

    async def action_create_role(self, request):
        body = await request.json()
        guild = self.only_guild()
        name = (body.get("name") or "").strip()
        if guild is None or not name:
            return bad_request("Needs a role name (and the bot in exactly one server)")
        if not guild.me.guild_permissions.manage_roles:
            return web.json_response({"status": "error", "error": "Vaulty lacks Manage Roles on the server"}, status=403)
        if discord.utils.get(guild.roles, name=name):
            return bad_request(f"A role called '{name}' already exists")
        colour = discord.Colour(int(str(body.get("color", "#000000")).lstrip("#"), 16))
        title = f"Create the role '{name}'"
        lines = [f"Server: {guild.name}", f"Colour: {colour}", "No permissions of its own; it only unlocks channels.",
                 f"Shown separately in the member list: {'yes' if body.get('hoist') else 'no'}",
                 f"Placed below Vaulty's highest role ({guild.me.top_role.name}), so Vaulty can hand it out."]
        if not await self.ask_gm(title, lines):
            self.log_action(title, lines, "rejected")
            return web.json_response({"status": "rejected"})
        role = await guild.create_role(name=name, colour=colour, hoist=bool(body.get("hoist")),
                                       mentionable=False, reason=body.get("reason") or "Created by Vaulty")
        self.log_action(title, lines, "approved", f"role id {role.id}")
        return web.json_response({"status": "created", "role_id": str(role.id)})

    async def action_post_terms(self, request):
        body = await request.json()
        channel = self.find_text_channel(body.get("channel", ""))
        if channel is None:
            return bad_request(f"No text channel called or with id '{body.get('channel')}'")
        missing = missing_post_permissions(channel)
        if missing:
            return web.json_response({"status": "error", "error": f"Vaulty lacks {', '.join(missing)} in #{channel.name}"}, status=403)
        guild = channel.guild
        role = discord.utils.get(guild.roles, name=body.get("role", "")) or (
            guild.get_role(int(body["role"])) if str(body.get("role", "")).isdigit() else None)
        if role is None:
            return bad_request(f"No role '{body.get('role')}': create it first")
        if not guild.me.guild_permissions.manage_roles or role >= guild.me.top_role:
            return web.json_response({"status": "error", "error":
                f"Vaulty can't hand out '{role.name}': it needs Manage Roles and a role above it"}, status=403)
        embeds, problems = [], []
        for spec in body.get("embeds", []):
            embed, issues = build_embed(spec)
            embeds.append(embed)
            problems += issues
        if not embeds or len(embeds) > 10:
            problems.append("needs 1-10 embeds")
        if sum(len(e) for e in embeds) > EMBED_LIMITS["total"]:
            problems.append("all embeds together must stay under 6000 characters")
        if problems:
            return bad_request("; ".join(problems))
        version = int(body.get("version", 1))

        title = f"Post the terms (v{version}) in #{channel.name}"
        lines = [f"Channel: #{channel.name}", f"Role given on Accept: {role.name}",
                 "Embeds: " + " | ".join(e.title or "(untitled)" for e in embeds),
                 "Buttons: " + " · ".join(CONSENT_BUTTONS[verb][0] for verb in ("accept", "withdraw"))]
        consent = load_consent()
        if consent.get("version") and consent["version"] != version:
            lines.append(f"Note: the stored terms are v{consent['version']}; earlier acceptances stay recorded under their version.")
        if not await self.ask_gm(title, lines):
            self.log_action(title, lines, "rejected")
            return web.json_response({"status": "rejected"})
        message = await channel.send(embeds=embeds, view=consent_view(), allowed_mentions=discord.AllowedMentions.none())
        consent.update({"role_id": str(role.id), "version": version, "info": body.get("info", "")})
        consent.setdefault("accepted", {})
        consent.setdefault("posts", []).append({"channel_id": str(channel.id), "message_id": str(message.id),
                                                 "version": version})
        save_consent(consent)
        self.log_action(title, lines, "approved", message.jump_url)
        return web.json_response({"status": "posted", "url": message.jump_url})

    async def action_apply_structure(self, request):
        """Create categories and channels from a spec; existing ones (by name) are left alone."""
        spec = await request.json()
        guild = self.only_guild()
        if guild is None:
            return bad_request("The bot must be in exactly one server")
        if not guild.me.guild_permissions.manage_channels:
            return web.json_response({"status": "error", "error": "Vaulty lacks Manage Channels on the server"}, status=403)
        # Validate every role name before asking.
        names = set()
        for category in spec.get("categories", []):
            names |= set((category.get("overwrites") or {}).keys())
            for channel in category.get("channels", []):
                names |= set((channel.get("overwrites") or {}).keys())
        unknown = [n for n in names if resolve_target(guild, n) is None]
        if unknown:
            return bad_request(f"Unknown roles: {', '.join(unknown)}")
        unknown_keys = {key for c in spec.get("categories", [])
                        for perms in [*(c.get("overwrites") or {}).values(),
                                      *[p for ch in c.get("channels", []) for p in (ch.get("overwrites") or {}).values()]]
                        for key in perms if key not in PERMISSIONS}
        if unknown_keys:
            return bad_request(f"Unknown permission keys: {', '.join(sorted(unknown_keys))} (use {', '.join(PERMISSIONS)})")
        lacking = permissions_missing(guild, spec)
        if lacking:
            return web.json_response({"status": "error", "error":
                "Vaulty can only set permissions it has itself; it's missing: " + ", ".join(lacking)}, status=403)
        my_access = bot_access(guild)
        # Inside an existing category Vaulty needs to see it and manage channels and permissions there.
        blocked = []
        for category_spec in spec.get("categories", []):
            existing = discord.utils.get(guild.categories, name=category_spec["name"])
            if existing and category_spec.get("channels"):
                here = existing.permissions_for(guild.me)
                lacking_here = [name for name, ok in (("View Channel", here.view_channel),
                                                      ("Manage Channels", here.manage_channels),
                                                      ("Manage Permissions", here.manage_roles)) if not ok]
                if lacking_here:
                    blocked.append(f"'{existing.name}' ({', '.join(lacking_here)})")
        if blocked:
            return web.json_response({"status": "error", "error":
                "Vaulty can't work inside " + "; ".join(blocked) + ". Add Vaulty to that category's permissions "
                "with View Channel allowed (its server-wide Manage Channels / Manage Roles then apply)."}, status=403)

        plan, lines = [], []
        for category_spec in spec.get("categories", []):
            existing = discord.utils.get(guild.categories, name=category_spec["name"])
            base = existing.overwrites if existing else merged_overwrites(guild, {}, category_spec.get("overwrites"))
            if not existing:
                base = dict(base)
                base[guild.me] = discord.PermissionOverwrite(**my_access)  # the bot keeps access to what it makes
            lines.append(("Category (exists): " if existing else "NEW category: ") + category_spec["name"]
                         + ("" if existing else f" · access: {describe_access(base)}"))
            channels = []
            for channel_spec in category_spec.get("channels", []):
                present = existing and discord.utils.get(existing.channels, name=channel_spec["name"])
                kind = channel_spec.get("type", "text")
                if present:
                    lines.append(f"  #{channel_spec['name']} already exists: skipped")
                    continue
                overwrites = None
                if channel_spec.get("overwrites") or channel_spec.get("read_only"):
                    overwrites = merged_overwrites(guild, base, channel_spec.get("overwrites"))
                    overwrites[guild.me] = discord.PermissionOverwrite(**my_access)
                    if channel_spec.get("read_only"):
                        overwrites = make_read_only(guild, overwrites)
                topic = channel_spec.get("topic", "")
                lines.append(f"  NEW {kind} #{channel_spec['name']}"
                             + (" (read-only)" if channel_spec.get("read_only") else "")
                             + (f" · tags: {', '.join(channel_spec.get('tags', []))}" if channel_spec.get("tags") else ""))
                lines.append(f"      topic: {topic[:150]}{'...' if len(topic) > 150 else ''}")
                if overwrites:
                    lines.append(f"      access: {describe_access(overwrites)}")
                channels.append((channel_spec, overwrites))
            plan.append((category_spec, existing, base, channels))

        title = "Create channels"
        if not await self.ask_gm(title, lines):
            self.log_action(title, lines, "rejected")
            return web.json_response({"status": "rejected"})

        created = []
        try:
            await self.build_structure(guild, plan, created)
        except discord.HTTPException as error:
            self.log_action(title, lines, "failed", f"{error.text} · created before the error: {'; '.join(created) or 'nothing'}")
            return web.json_response({"status": "error", "error": f"Discord refused: {error.text}",
                                      "created_before_error": created}, status=502)
        self.log_action(title, lines, "approved", "; ".join(created) or "nothing new")
        return web.json_response({"status": "created", "created": created})

    async def build_structure(self, guild, plan, created):
        for category_spec, existing, base, channels in plan:
            category = existing
            if category is None:
                category = await guild.create_category(category_spec["name"], overwrites=base, reason="Vaulty: apply structure")
                after = discord.utils.get(guild.categories, name=category_spec.get("after", ""))
                if after:
                    await category.edit(position=after.position + 1)
                created.append(f"category {category.name}")
            for channel_spec, overwrites in channels:
                options = {"name": channel_spec["name"], "category": category, "reason": "Vaulty: apply structure"}
                if overwrites:
                    options["overwrites"] = overwrites
                if channel_spec.get("type") == "forum":
                    options["topic"] = channel_spec.get("topic", "")
                    options["available_tags"] = [discord.ForumTag(name=t) for t in channel_spec.get("tags", [])]
                    channel = await guild.create_forum(**options)
                else:
                    options["topic"] = channel_spec.get("topic", "")
                    if channel_spec.get("slowmode"):
                        options["slowmode_delay"] = int(channel_spec["slowmode"])
                    channel = await guild.create_text_channel(**options)
                created.append(f"#{channel.name} ({channel.id})")
                print(f"Created #{channel.name}")


def main() -> int:
    token = keyring.get_password(SERVICE, USERNAME)
    if not token:
        print(f"No token stored. Run: python -m keyring set {SERVICE} {USERNAME}")
        return 1
    intents = discord.Intents.default()
    intents.message_content = True  # privileged; enabled in the Developer Portal for the read tool
    client = Vaultulation(intents=intents)
    client.run(token.strip())
    if getattr(client, "respawn", False):
        # Restart requested without run_bot.py: open a fresh copy in a new window.
        subprocess.Popen([sys.executable, *sys.argv], cwd=str(Path(__file__).resolve().parent),
                         creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0))
    return getattr(client, "exit_code", 0)  # RESTART_CODE asks run_bot.py to start it again


if __name__ == "__main__":
    sys.exit(main())
