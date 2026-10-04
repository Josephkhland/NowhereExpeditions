"""Work out the public site's next release version and write public-site/version.json.

Run by the deploy workflow before the site is uploaded. Versions are Major.Minor.Patch and every
release is a git tag (v1.4.2). Each deploy with new commits bumps Patch; the rules in
.github/versioning.json decide when Minor or Major move instead. A redeploy with nothing new
keeps the current version.

Preview locally (changes nothing but version.json):  python .github/scripts/release_version.py
"""

import argparse
import datetime
import fnmatch
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT / ".github" / "versioning.json"
VERSION_FILE = ROOT / "public-site" / "version.json"
LEVELS = ("major", "minor", "patch")
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
DATE_IN_MESSAGE = re.compile(r"\((\d{4}-\d{2}-\d{2})\)")


def parse_version(text):
    match = SEMVER.match(text.strip())
    if not match:
        raise ValueError(f"Not a Major.Minor.Patch version: {text!r}")
    return tuple(int(part) for part in match.groups())


def bump(version, level):
    major, minor, patch = version
    if level == "major":
        return (major + 1, 0, 0)
    if level == "minor":
        return (major, minor + 1, 0)
    return (major, minor, patch + 1)


def format_version(version):
    return ".".join(str(part) for part in version)


def decide_level(config, messages, changed_files, labels):
    """The largest bump any rule asks for, and why. Patch when no rule matches."""
    lowered = [message.lower() for message in messages]
    label_set = {label.lower() for label in labels}
    for level in ("major", "minor"):
        rule = config.get(level) or {}
        for marker in rule.get("markers", []):
            if any(marker.lower() in message for message in lowered):
                return level, f'a commit message contains "{marker}"'
        for label in rule.get("labels", []):
            if label.lower() in label_set:
                return level, f'a merged pull request is labelled "{label}"'
        for pattern in rule.get("paths", []):
            hit = next((path for path in changed_files if fnmatch.fnmatch(path, pattern)), None)
            if hit:
                return level, f'{hit} matches "{pattern}"'
    return "patch", "default for a new deploy"


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def latest_tag(prefix):
    """The highest released version and its tag, or (None, None) before the first release."""
    best = (None, None)
    for tag in git("tag", "--list", f"{prefix}*").split():
        try:
            version = parse_version(tag[len(prefix):])
        except ValueError:
            continue
        if best[0] is None or version > best[0]:
            best = (version, tag)
    return best


def commits_since(tag):
    log = git("log", "--format=%H%x1f%B%x1e", f"{tag}..HEAD" if tag else "HEAD")
    commits = []
    for entry in log.split("\x1e"):
        if "\x1f" in entry:
            sha, message = entry.split("\x1f", 1)
            commits.append((sha.strip(), message.strip()))
    return commits


def pull_request_labels(shas):
    """Labels of the pull requests that brought these commits in. Needs GITHUB_TOKEN; skipped without it."""
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not (token and repo):
        return set()
    from urllib.request import Request, urlopen
    labels = set()
    for sha in shas[:100]:
        request = Request(f"https://api.github.com/repos/{repo}/commits/{sha}/pulls",
                          headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
        try:
            with urlopen(request, timeout=15) as response:
                for pull in json.load(response):
                    labels.update(label["name"] for label in pull.get("labels", []))
        except Exception as error:  # A label lookup failing should never block a deploy.
            print(f"warning: could not read pull requests for {sha[:7]}: {error}", file=sys.stderr)
    return labels


def today(timezone):
    try:
        from zoneinfo import ZoneInfo
        return datetime.datetime.now(ZoneInfo(timezone)).date().isoformat()
    except Exception:
        return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def tag_date(tag):
    """The release date recorded in an existing tag's message ("v1.4.2 (2026-10-04)")."""
    match = DATE_IN_MESSAGE.search(git("tag", "--list", "--format=%(contents)", tag))
    if match:
        return match.group(1)
    return git("log", "-1", "--format=%cs", tag).strip()


def plan(config, forced="auto"):
    prefix = config.get("tagPrefix", "v")
    previous, previous_tag = latest_tag(prefix)
    commits = commits_since(previous_tag)
    if previous is None:
        version, level, reason, is_new = parse_version(config.get("firstVersion", "1.0.0")), "first", "first release", True
    elif forced in LEVELS:
        version, level, reason, is_new = bump(previous, forced), forced, "chosen when the workflow was run by hand", True
    elif not commits:
        version, level, reason, is_new = previous, "none", "no new commits since the last release (redeploy)", False
    else:
        changed = git("diff", "--name-only", previous_tag, "HEAD").split()
        rules_use_labels = any((config.get(level) or {}).get("labels") for level in ("major", "minor"))
        labels = pull_request_labels([sha for sha, _ in commits]) if rules_use_labels else set()
        level, reason = decide_level(config, [message for _, message in commits], changed, labels)
        version, is_new = bump(previous, level), True
    tag = f"{prefix}{format_version(version)}"
    return {
        "version": format_version(version),
        "tag": tag,
        "date": today(config.get("timezone", "UTC")) if is_new else tag_date(tag),
        "previous": format_version(previous) if previous else None,
        "bump": level,
        "reason": reason,
        "new": is_new,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--bump", default="auto", choices=("auto", *LEVELS), help="force a bump (default: follow the rules)")
    parser.add_argument("--output", default=str(VERSION_FILE), help="where to write version.json")
    args = parser.parse_args()

    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    release = plan(config, args.bump)
    commit = git("rev-parse", "HEAD").strip()
    repo = os.environ.get("GITHUB_REPOSITORY")
    server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    site_info = {
        "version": release["version"],
        "date": release["date"],
        "tag": release["tag"],
        "commit": commit[:7],
        "url": f"{server}/{repo}/releases/tag/{release['tag']}" if repo else "",
    }
    Path(args.output).write_text(json.dumps(site_info, indent=2) + "\n", encoding="utf-8")

    summary = (f"{release['version']} ({release['date']}) - "
               + (f"{release['bump']} bump from {release['previous']}: {release['reason']}" if release["previous"] and release["new"]
                  else release["reason"]))
    print(summary)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
            for key in ("version", "tag", "date", "bump"):
                out.write(f"{key}={release[key]}\n")
            out.write(f"new={'true' if release['new'] else 'false'}\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as out:
            out.write(f"### Site version {release['version']} ({release['date']})\n\n{summary}\n")


if __name__ == "__main__":
    main()
