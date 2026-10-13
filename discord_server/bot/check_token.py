"""Check that the bot token stored in Windows Credential Manager works.

Asks Discord which bot the token belongs to and prints only the bot's name.
Never prints the token.

    python check_token.py
"""

import json
import sys
import urllib.error
import urllib.request

import keyring

SERVICE = "Vaultulation"
USERNAME = "bot"


def main() -> int:
    token = keyring.get_password(SERVICE, USERNAME)
    if not token:
        print(f"No token stored. Run: python -m keyring set {SERVICE} {USERNAME}")
        return 1

    request = urllib.request.Request(
        "https://discord.com/api/v10/users/@me",
        headers={
            "Authorization": f"Bot {token.strip()}",
            "User-Agent": "DiscordBot (https://github.com/Josephkhland/NowhereExpeditions, 0.1)",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            bot = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 401:
            print("Discord rejected the token (401). It was probably pasted wrong; store it again.")
        else:
            print(f"Discord answered with HTTP {error.code}.")
        return 1
    except urllib.error.URLError as error:
        print(f"Could not reach Discord: {error.reason}")
        return 1

    print(f"Token works. It belongs to the bot: {bot.get('username')} (id {bot.get('id')})")
    if token != token.strip():
        print("Note: the stored token has extra spaces or a line break around it. It works, but consider storing it again.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
