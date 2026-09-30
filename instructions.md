# Nowhere Expeditions Website — Copilot Instructions
(This is instructions for the site to be created within the subfolder public-site).

## Project Purpose

This repository contains the public campaign website and player-facing documentation for **Nowhere Expeditions**, a Fate RPG campaign using a West Marches structure.

The website serves two purposes:

1. It is the players' primary reference for campaign rules, world information, discoveries, Gates, expeditions, and the current state of the Island.
2. It represents an in-world information system used by Expeditioners and the organizations operating on the Island.

The website should therefore feel like part campaign handbook, part expedition database, and part industrial exploration terminal.

Do not treat this project as a generic fantasy RPG wiki.

---

# Campaign Principles

All implementation and content decisions should preserve these principles.

## Exploration Over Plot

The campaign presents locations, situations, mysteries, hazards, factions and opportunities.

Do not write content that assumes a predetermined sequence of player actions.

## Player-Driven Expeditions

Players decide which Gates, threats, mysteries and projects deserve their attention.

The website should make available choices easy to discover.

## Persistent World

Expeditions permanently affect the campaign.

The website represents the current known state of that world and should evolve as the campaign develops.

## Knowledge Is Progression

Information discovered during expeditions is itself a reward.

Gate records, creature observations, maps, artifact research and environmental rules should be capable of expanding as discoveries are made.

Do not automatically expose information that the Expeditioners have not discovered.

## The Island Matters

The Island is mechanically significant and effectively functions as a shared campaign character.

Its capabilities, Aspects, facilities, problems, projects, Stress and Consequences should be visible and understandable to players.

## Different Crews, Shared World

There is no permanent adventuring party.

The website must therefore work for players who participate in different combinations and may have missed previous sessions.

A returning player should be able to understand the current campaign state without reading every previous session log.

---

# Technical Direction

The site must remain suitable for deployment through **GitHub Pages**.

Prefer static technologies and simple architecture.

Use, in order of preference:

- HTML
- CSS
- Markdown
- YAML/JSON structured data
- minimal vanilla JavaScript where interaction genuinely requires it

Avoid adding large frontend frameworks unless explicitly requested.

Do not introduce React, Vue, Angular, databases, backend services, authentication systems or build complexity merely for convenience.

Prefer browser-native functionality whenever practical.

For example, use `<details>` and `<summary>` for expandable information when they satisfy the requirement.

The website should remain:

- fast;
- readable;
- responsive;
- accessible;
- easy to maintain through Git;
- easy to modify manually;
- understandable by someone inspecting the repository.

---

# Content Architecture

Separate campaign data from presentation wherever practical.

Prefer structured data for frequently changing campaign state.

Example:

```text
_data/
    island.yml
    gates.yml
    projects.yml

island/
    index.md
    projects.md
    facilities.md

expeditions/
    index.md

archive/
    gates/
    artifacts/
    creatures/
    discoveries/

rules/
    index.md
    island-capabilities.md
    expeditions.md

assets/
    css/
    js/
    images/
```

Do not duplicate authoritative campaign data across multiple files when it can reasonably have one source of truth.

---

# Island Sheet

The Island should have a prominent public page functioning similarly to a Fate character sheet.

At minimum it should be capable of displaying:

- Island name
- High Concept
- Trouble
- additional Island Aspects
- Industry
- Research
- Commerce
- Security
- Medicine
- Infrastructure
- Island Stress
- Island Consequences
- completed facilities
- active projects
- relevant persistent conditions

Capabilities must never be displayed as unexplained numbers alone.

Players should be able to expand or select a Capability and learn:

- what it represents in the fiction;
- what its current rating means;
- how Expeditioners can use it;
- what facilities or assets currently contribute to it;
- whether current Consequences or conditions affect it.

The Island Sheet should prioritize quick comprehension.

A player should be able to inspect it and rapidly answer:

**What is the Island good at?**

**What problems does it currently have?**

**What has been built?**

**What is currently being built?**

**What resources or capabilities can my Expeditioner make use of?**

---

# Expedition Board

The Expedition Board represents currently available adventures and opportunities.

Gate or mission entries should support information such as:

- designation;
- name;
- status;
- classification;
- known environment;
- objectives;
- known hazards;
- rewards;
- crew information;
- relevant discoveries;
- links to existing reports.

Unknown information should remain visibly unknown rather than being filled with invented content.

Examples include:

`UNKNOWN`

`UNCLASSIFIED`

`NO DATA`

`NOT YET SURVEYED`

The absence of information is meaningful in this campaign.

---

# Gate Archive

Each Gate should be capable of developing its own record.

A Gate record may eventually contain:

- initial briefing;
- known environment;
- discovered environmental rules;
- locations;
- creatures;
- inhabitants;
- hazards;
- artifacts;
- resources;
- expedition reports;
- maps;
- photographs or illustrations;
- research notes;
- Core information;
- final status.

Gate pages should evolve as Expeditioners discover information.

Do not assume that every field should be visible when the Gate is first created.

A newly discovered Gate might have an extremely sparse record.

A heavily explored Gate might eventually have extensive documentation.

This difference is intentional.

---

# Public Knowledge and GM Knowledge

Treat the website as **player-facing by default**.

Do not place secret GM information into public pages.

Do not reveal:

- undiscovered Gate rules;
- hidden locations;
- secret NPC motivations;
- undiscovered creatures;
- unrecovered artifacts;
- mystery solutions;
- future events;
- Guardian mechanics that players have not learned;
- the true nature of Cores or Gates unless established as public campaign knowledge.

If source documents contain both public and secret information, do not assume everything belongs on the website.

When uncertain whether information should be public, ask before publishing it.

Never invent a public discovery merely to make a page appear complete.

---

# Canon and Content Integrity

Existing campaign documents are authoritative unless explicitly superseded.

When creating or modifying lore:

1. Search existing project documentation first.
2. Reuse established terminology.
3. Check whether the requested information already exists.
4. Avoid silently changing established facts.
5. Do not invent missing lore unless specifically asked to design new material.
6. Clearly distinguish placeholders from established canon.

If two sources contradict each other, do not silently choose one.

Report the contradiction and ask for clarification when it materially affects the requested work.

---

# Rules Integrity

This campaign uses Fate.

Do not silently invent Fate mechanics.

When documenting a mechanic, distinguish between:

- standard Fate rules;
- established Nowhere Expeditions house rules;
- proposed mechanics;
- examples;
- purely fictional descriptions.

If a mechanic has not yet been defined, mark it as undefined or propose it separately rather than presenting an assumption as an established rule.

---

# Design Language

The visual identity should communicate:

**industrial expedition infrastructure + scientific documentation + impossible phenomena**

Prefer the feeling of:

- expedition records;
- engineering documentation;
- industrial signage;
- research terminals;
- survey reports;
- anomalous-object archives;
- utilitarian institutional interfaces.

Avoid making the site look primarily like:

- a medieval fantasy wiki;
- a cyberpunk hacker terminal;
- a generic corporate SaaS dashboard;
- a videogame inventory UI.

The Island is industrial, practical and increasingly shaped by impossible technology.

The supernatural should contrast with that practical foundation.

---

# Interface Principles

Prioritize information clarity over decorative complexity.

Use progressive disclosure.

Important information should be visible immediately.

Detailed explanations should be expandable.

For example:

```text
RESEARCH +2
Gate investigation, artifact analysis and anomalous research.

[More Information]

    What Research Represents

    How Expeditioners Use Research

    Current Research Facilities

    Relevant Conditions
```

Avoid requiring navigation to another page simply to understand a basic term.

Tooltips may supplement information but should not contain information that mobile users cannot otherwise access.

Expandable panels are preferred for substantial explanations.

---

# Mobile Support

Assume many players will access the website from a phone during a session.

Every important campaign function must therefore work on small screens.

Do not design core interfaces around hover interactions.

Tables should either respond gracefully on mobile or be replaced with cards where appropriate.

Navigation should remain usable without precise mouse input.

---

# Accessibility

Use semantic HTML.

Maintain readable contrast.

Provide meaningful link text.

Provide alt text for informative images.

Do not communicate mechanical state exclusively through color.

Interactive controls must be keyboard accessible.

Prefer native HTML controls where they provide the required behavior.

---

# Writing Style

Player-facing writing should be concise and functional.

Prefer:

**Security represents the Island's ability to defend itself, contain threats and respond to emergencies.**

Avoid unnecessary pseudo-bureaucratic filler that makes basic rules harder to understand.

In-world flavor may be used for headings, notices, classifications and atmospheric elements, but clarity takes priority when explaining mechanics.

---

# Repository Practices

Keep commits and changes focused.

Do not perform unrelated large refactors while implementing a small feature.

Preserve existing conventions unless there is a concrete reason to change them.

When introducing a dependency, explain why it is necessary.

Do not commit generated build artifacts unless the project's deployment approach requires them.

Do not store secrets, credentials or private GM information in files deployed through GitHub Pages.

Remember that removing a secret from the current version does not remove it from Git history.

---

# When Implementing a Feature

Before making substantial changes:

1. Inspect the existing repository structure.
2. Locate relevant campaign documentation and existing components.
3. Identify the authoritative source of the affected data.
4. Reuse existing styles and components where appropriate.
5. Determine whether the requested feature can be implemented without adding dependencies.

After implementation:

1. Verify internal links.
2. Check desktop layout.
3. Check mobile layout.
4. Check expandable/interactive elements.
5. Check keyboard accessibility where relevant.
6. Verify that no GM-only information was accidentally exposed.
7. Verify that established campaign terminology has not been unintentionally changed.
8. Summarize the files changed and any design decisions or unresolved questions.

---

# Current Campaign Foundation

The campaign centers on an industrial Island built around enormous ancient floating ruins.

Spatial anomalies called **Gates** appear around these ruins.

Gates lead to impossible environments beyond the known world.

Somewhere within each Gate is a **Core**.

Recovering the Core collapses the Gate.

Cores and materials recovered beyond the Gates are the world's only known source of magic.

Player characters are called **Expeditioners**.

Expeditioners organize into different crews for individual expeditions rather than belonging to a permanent party.

Expeditions recover knowledge, artifacts, magical materials, wealth and technology.

Those discoveries can change both individual Expeditioners and the Island itself.

The central long-term mystery concerns the origin and purpose of the Gates, Cores and ancient ruins.

Do not provide answers to those mysteries unless those answers have explicitly been established elsewhere in the project's canonical documentation.

---

# Current Island Capabilities

The established Island Capabilities are:

**Industry** — crafting, repairs and manufacturing.

**Research** — investigation, analysis and Gate knowledge.

**Commerce** — trade, funding and resources.

**Security** — defense, policing and military response.

**Medicine** — treatment and recovery.

**Infrastructure** — facilities, transportation and services.

These Capabilities are intended to matter mechanically during play rather than functioning only as settlement progression statistics.

Do not define exact mechanical procedures for them unless those procedures have been established in campaign rules or the user explicitly asks you to design them.

---

# Primary Goal

The website should make the persistent shared world of Nowhere Expeditions tangible.

A player visiting the site should be able to understand:

**Where are we?**

**What has happened?**

**What do we know?**

**What can we currently do?**

**What needs our attention?**

**Where could we go next?**

As expeditions occur, the website should increasingly become a record of what the Expeditioners themselves have discovered and changed.