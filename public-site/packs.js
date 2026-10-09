/* Expedition Packs: the rules the character sheet and the site share.
   - The Active Pack sets the Carry Limit. Without one, nothing extra fits (the limit counts as 0).
   - What is inside a Pack never counts toward carried weight; only stash Gear brought into action does,
     including extra copies of something the Pack already holds.
   - Your own Sponsor's Packs cost their Sponsor price (0 by default); everyone else pays the normal price (1).
   - Every owned Pack keeps what is left of each item (quantity out of the capacity it was packed with).
   Loaded as a plain script (window.NowherePacks) and by the content manager's tests (module.exports). */
(function (root) {
  "use strict";

  const MAX_QUANTITY = 99;
  const whole = (value, fallback = 0) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) ? number : fallback;
  };
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  const isOwnSponsorPack = (pack, sponsorId) => Boolean(sponsorId && pack && pack.sponsorId === sponsorId);
  const packPrice = (pack, sponsorId) => isOwnSponsorPack(pack, sponsorId)
    ? whole(pack.sponsorPrice, 0) : whole(pack?.price, 1);

  const activePack = (owned) => (Array.isArray(owned) ? owned : []).find((item) => item.active) || null;

  // The Active Pack's Carry Limit, or null when no Pack is active (or its definition is unknown).
  const carryLimit = (owned, packsById) => {
    const active = activePack(owned);
    const pack = active && packsById.get(active.packId);
    return pack && Number.isFinite(Number(pack.carryLimit)) ? Number(pack.carryLimit) : null;
  };

  // Weight of the stash Gear brought into action. Pack contents are not in the stash, so they never count.
  const carriedWeight = (stash, gearById) => (Array.isArray(stash) ? stash : [])
    .filter((item) => item.broughtIntoAction)
    .reduce((total, item) => total + (Number(gearById.get(item.gearId)?.weight) || 0) * (whole(item.quantity, 1) || 1), 0);

  // A stunt can let you carry more than your Pack allows (+1, +2), something else can weigh you down (-1): the Carry
  // modifier is added to the Active Pack's Carry Limit. Without an Active Pack there is no limit to modify.
  const carryModifier = (character) => whole(character.carryModifier, 0);
  const carryStatus = (character, packsById, gearById) => {
    const packLimit = carryLimit(character.packs, packsById);
    const modifier = carryModifier(character);
    const limit = packLimit === null ? null : Math.max(0, packLimit + modifier);
    const carried = carriedWeight(character.stash, gearById);
    const active = activePack(character.packs);
    return { limit, packLimit, modifier, carried, over: carried > (limit ?? 0), active, pack: active ? packsById.get(active.packId) || null : null };
  };

  // "Forgot something?": producing an owned item mid-expedition costs 1 stress if it still fits the Active Pack's
  // Carry Limit, or 1 Fate Point if it takes you over (no Active Pack: nothing extra fits).
  const forgotCost = (status, addedWeight) => status.carried + Math.max(0, Number(addedWeight) || 0) <= (status.limit ?? 0)
    ? "stress" : "fate-point";

  const nextInstanceId = (owned) => {
    const used = new Set((owned || []).map((item) => item.id));
    let number = (owned || []).length + 1;
    while (used.has(`pack-${number}`)) number += 1;
    return `pack-${number}`;
  };

  // A freshly packed copy of a Pack: every item at the quantity the definition lists.
  const newInstance = (pack, id, active = false) => ({
    id, packId: pack.id, active: Boolean(active),
    contents: (pack.contents || []).map((item) => ({ gearId: item.gearId, quantity: item.quantity, capacity: item.quantity }))
  });

  // Exactly one Active Pack (or none, with null).
  const setActive = (owned, instanceId) => owned.map((item) => ({ ...item, active: item.id === instanceId }));

  // Use up, lose or recover something inside a Pack, within 0..what it was packed with.
  const adjustItem = (instance, gearId, delta) => ({
    ...instance,
    contents: instance.contents.map((item) => item.gearId === gearId
      ? { ...item, quantity: clamp(item.quantity + whole(delta), 0, item.capacity) } : item)
  });

  // Owned Packs as read from a file, a draft or the published record. Older data has none.
  const normalizeOwned = (value) => {
    const owned = [];
    (Array.isArray(value) ? value : []).forEach((item) => {
      if (!item || typeof item.packId !== "string" || !item.packId) return;
      const seen = new Set();
      const contents = (Array.isArray(item.contents) ? item.contents : []).filter((entry) => {
        if (!entry || typeof entry.gearId !== "string" || seen.has(entry.gearId)) return false;
        seen.add(entry.gearId);
        return true;
      }).map((entry) => {
        const capacity = clamp(whole(entry.capacity ?? entry.quantity), 0, MAX_QUANTITY);
        return { gearId: entry.gearId, quantity: clamp(whole(entry.quantity ?? capacity), 0, capacity), capacity };
      });
      const id = typeof item.id === "string" && item.id && !owned.some((other) => other.id === item.id) ? item.id : nextInstanceId(owned);
      owned.push({ id, packId: item.packId, active: Boolean(item.active) && !owned.some((other) => other.active), contents });
    });
    return owned;
  };

  // A character with a known Sponsor and no Pack receives that Sponsor's starting Pack, as the Active Pack.
  const grantStartingPack = (owned, sponsor, packsById) => {
    const pack = sponsor?.packId ? packsById.get(sponsor.packId) : null;
    if ((owned || []).length || !pack) return owned || [];
    return [newInstance(pack, "pack-1", true)];
  };

  /* Components and bundles. A component (one Ration) is not sold or stashed alone; it comes inside Packs and bundles.
     A bundle (a Rations Kit, weight 1) holds components; bringing it brings its supplies, tracked per stash entry
     as `used` so each kit keeps its own count (Rations Kit: 4 / 5) beside the Pack's own (Rations: 2 / 5). */
  const isSoldAlone = (gear) => Boolean(gear) && gear.marketplaceVisible !== false;

  // Supplies inside one unit of a Gear, expanded down to Gear that holds nothing else. Plain Gear supplies nothing.
  const bundleSupplies = (gearId, gearById, seen = new Set()) => {
    const supplies = {};
    (gearById.get(gearId)?.contents || []).forEach((item) => {
      if (item.gearId === gearId || seen.has(item.gearId)) return;
      const inner = bundleSupplies(item.gearId, gearById, new Set([...seen, gearId]));
      const leaves = Object.keys(inner).length ? Object.entries(inner) : [[item.gearId, 1]];
      leaves.forEach(([key, quantity]) => { supplies[key] = (supplies[key] || 0) + quantity * whole(item.quantity, 1); });
    });
    return supplies;
  };

  // What a stash entry still holds: [{gearId, quantity (left), capacity}]. Empty for plain Gear.
  const stashSupplies = (item, gearById) => Object.entries(bundleSupplies(item.gearId, gearById)).map(([gearId, perUnit]) => {
    const capacity = perUnit * (whole(item.quantity, 1) || 1);
    const used = whole((item.used || []).find((entry) => entry.gearId === gearId)?.quantity, 0);
    return { gearId, capacity, quantity: clamp(capacity - used, 0, capacity) };
  });

  // Use (delta -1) or recover (delta +1) a supply from a stashed bundle.
  const adjustSupply = (item, gearId, delta, gearById) => {
    const supply = stashSupplies(item, gearById).find((entry) => entry.gearId === gearId);
    if (!supply) return item;
    const used = clamp(supply.capacity - clamp(supply.quantity + whole(delta), 0, supply.capacity), 0, supply.capacity);
    const others = (item.used || []).filter((entry) => entry.gearId !== gearId);
    const next = { ...item, used: used ? [...others, { gearId, quantity: used }] : others };
    if (!next.used.length) delete next.used;
    return next;
  };

  // Everything usable on an expedition: the Active Pack's contents plus the supplies of bundles brought into action.
  // Totals per Gear, each with the sources it comes from so nothing is merged into an anonymous pool.
  const suppliesOnHand = (character, gearById) => {
    const totals = new Map();
    const add = (gearId, quantity, capacity, source) => {
      const entry = totals.get(gearId) || { gearId, quantity: 0, capacity: 0, sources: [] };
      entry.quantity += quantity;
      entry.capacity += capacity;
      entry.sources.push({ source, quantity, capacity });
      totals.set(gearId, entry);
    };
    (activePack(character.packs)?.contents || []).forEach((item) => add(item.gearId, item.quantity, item.capacity, "pack"));
    (character.stash || []).filter((item) => item.broughtIntoAction).forEach((item) =>
      stashSupplies(item, gearById).forEach((supply) => add(supply.gearId, supply.quantity, supply.capacity, item.gearId)));
    return [...totals.values()];
  };

  /* The Sponsor's Extra, written into the character's Extras when they choose a Sponsor (as their Pack is given).
     Choosing another Sponsor swaps the block only while it is unedited; anything the player wrote stays. */
  const sponsorExtraBlock = (sponsor) => sponsor && (sponsor.extraName || sponsor.extraRule)
    ? `Recruitment Faction: ${sponsor.name}\n${sponsor.extraName ? `${sponsor.extraName}: ` : ""}${String(sponsor.extraRule || "").replace(/\*\*/g, "")}`.trim()
    : "";
  const applySponsorExtra = (extras, previous, next) => {
    let text = String(extras || "");
    const old = sponsorExtraBlock(previous);
    const fresh = sponsorExtraBlock(next);
    if (old && text.includes(old)) text = text.replace(old, fresh);
    else if (fresh && !text.includes(fresh)) text = text.trim() ? `${fresh}\n\n${text}` : fresh;
    return text.replace(/\n{3,}/g, "\n\n").trim();
  };

  /* Armor: instead of Physical Stress it could reasonably stop, mark one of its boxes. Marked boxes stay marked until
     the Armor is repaired or replaced; nothing here clears them on its own. */
  const armorStatus = (item, gearById) => {
    const boxes = whole(gearById.get(item.gearId)?.armorBoxes, 0) * (whole(item.quantity, 1) || 1);
    return { boxes, marked: clamp(whole(item.armorMarked, 0), 0, boxes) };
  };
  // Clicking box n (0-based) marks up to it, or clears it and the ones after when it is already marked (as stress boxes).
  const toggleArmorBox = (item, box, gearById) => {
    const { boxes, marked } = armorStatus(item, gearById);
    const next = clamp(box < marked ? box : box + 1, 0, boxes);
    const result = { ...item, armorMarked: next };
    if (!next) delete result.armorMarked;
    return result;
  };

  const api = { armorStatus, toggleArmorBox, sponsorExtraBlock, applySponsorExtra, isOwnSponsorPack, packPrice, activePack, carryLimit, carriedWeight, carryStatus, forgotCost, nextInstanceId,
    newInstance, setActive, adjustItem, normalizeOwned, grantStartingPack, isSoldAlone, bundleSupplies, stashSupplies,
    adjustSupply, suppliesOnHand };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NowherePacks = api;
})(typeof window !== "undefined" ? window : globalThis);
