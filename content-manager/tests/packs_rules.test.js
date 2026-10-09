// Run by test_app.py (node --test). The Pack rules the public character sheet and site use.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Packs = require(path.join(__dirname, "..", "..", "public-site", "packs.js"));

const gear = new Map([
  ["rope", { id: "rope", weight: 1 }], ["lantern-oil", { id: "lantern-oil", weight: 0 }],
  ["surveying-instruments", { id: "surveying-instruments", weight: 2 }], ["rifle", { id: "rifle", weight: 2 }],
  ["climbing-kit", { id: "climbing-kit", weight: 3 }]
]);
const university = { id: "university-field-pack", sponsorId: "faction-university-of-verna", carryLimit: 6, price: 1, sponsorPrice: 0,
  contents: [{ gearId: "rope", quantity: 1 }, { gearId: "lantern-oil", quantity: 2 }] };
const company = { id: "nowhere-expeditions-pack", sponsorId: "faction-nowhere-expeditions", carryLimit: 6, price: 1, sponsorPrice: 0, contents: [] };
const independent = { id: "independent-pack", sponsorId: "faction-independent", carryLimit: 6, price: 1, sponsorPrice: 0, contents: [] };
const heavy = { id: "heavy-pack", sponsorId: null, carryLimit: 8, price: 3, sponsorPrice: 0, contents: [] };
const packsById = new Map([university, company, independent, heavy].map((pack) => [pack.id, pack]));

test("your own Sponsor's Pack is free, any other Sponsor's costs 1 Coin", () => {
  const prices = (sponsorId) => [university, company, independent].map((pack) => Packs.packPrice(pack, sponsorId));
  assert.deepEqual(prices("faction-university-of-verna"), [0, 1, 1]);
  assert.deepEqual(prices("faction-nowhere-expeditions"), [1, 0, 1]);
  assert.deepEqual(prices("a-sponsor-published-later"), [1, 1, 1], "works for any Sponsor ID, nothing hard-coded");
  assert.deepEqual(prices(null), [1, 1, 1], "no Sponsor: everyone pays");
  assert.equal(Packs.packPrice(heavy, "faction-university-of-verna"), 3, "a Pack without a Sponsor costs its price");
});

test("a character with a Sponsor and no Pack receives the Sponsor's Pack, active", () => {
  const owned = Packs.grantStartingPack([], { id: "faction-university-of-verna", packId: university.id }, packsById);
  assert.deepEqual(owned, [{ id: "pack-1", packId: university.id, active: true, contents: [
    { gearId: "rope", quantity: 1, capacity: 1 }, { gearId: "lantern-oil", quantity: 2, capacity: 2 }] }]);
  const already = [Packs.newInstance(company, "pack-1", true)];
  assert.equal(Packs.grantStartingPack(already, { packId: university.id }, packsById), already, "owning a Pack: nothing is granted");
  assert.deepEqual(Packs.grantStartingPack([], { packId: null }, packsById), [], "a Sponsor without a Pack grants nothing");
});

test("only one Pack is active, and switching it changes the Carry Limit", () => {
  let owned = [Packs.newInstance(university, "pack-1", true), Packs.newInstance(heavy, "pack-2")];
  assert.equal(Packs.carryLimit(owned, packsById), 6);
  owned = Packs.setActive(owned, "pack-2");
  assert.deepEqual(owned.map((item) => item.active), [false, true]);
  assert.equal(Packs.carryLimit(owned, packsById), 8);
  owned = Packs.setActive(owned, null);
  assert.equal(Packs.carryLimit(owned, packsById), null, "no Active Pack: no Carry Limit is assumed");
  const loaded = Packs.normalizeOwned([{ packId: university.id, active: true }, { packId: heavy.id, active: true }]);
  assert.deepEqual(loaded.map((item) => [item.id, item.active]), [["pack-1", true], ["pack-2", false]], "a file with two active Packs keeps the first");
});

test("Pack contents are used up within their bounds and stay used", () => {
  let pack = Packs.newInstance(university, "pack-1", true);
  pack = Packs.adjustItem(pack, "lantern-oil", -1);
  pack = Packs.adjustItem(pack, "rope", -1);
  pack = Packs.adjustItem(pack, "rope", -1);
  assert.deepEqual(pack.contents.map((item) => `${item.quantity}/${item.capacity}`), ["0/1", "1/2"]);
  pack = Packs.adjustItem(pack, "lantern-oil", 5);
  assert.equal(pack.contents[1].quantity, 2, "never more than it was packed with");
  const reloaded = Packs.normalizeOwned(JSON.parse(JSON.stringify([pack])));
  assert.deepEqual(reloaded[0].contents, pack.contents, "saving and reopening keeps what is left");
  assert.deepEqual(Packs.normalizeOwned([{ packId: "x", contents: [{ gearId: "rope", quantity: 9, capacity: 2 }] }])[0].contents,
    [{ gearId: "rope", quantity: 2, capacity: 2 }]);
});

test("carried weight counts extra Gear only, never what is inside the Pack", () => {
  const character = {
    packs: [Packs.newInstance(university, "pack-1", true)],
    stash: [
      { gearId: "rope", quantity: 1, broughtIntoAction: true },                  // an extra Rope beside the Pack's own
      { gearId: "surveying-instruments", quantity: 1, broughtIntoAction: true },
      { gearId: "rifle", quantity: 1, broughtIntoAction: true },
      { gearId: "climbing-kit", quantity: 1, broughtIntoAction: false }
    ]
  };
  const status = Packs.carryStatus(character, packsById, gear);
  assert.deepEqual([status.carried, status.limit, status.over], [5, 6, false]);
  assert.equal(status.pack, university);
});

test("Forgot something? is judged against the Active Pack's Carry Limit", () => {
  const stash = [{ gearId: "surveying-instruments", quantity: 2, broughtIntoAction: true }];
  const withPack = (pack) => Packs.carryStatus({ packs: [Packs.newInstance(pack, "pack-1", true)], stash }, packsById, gear);
  assert.equal(Packs.forgotCost(withPack(university), 2), "stress", "4 + 2 fits a limit of 6");
  assert.equal(Packs.forgotCost(withPack(university), 3), "fate-point", "4 + 3 is over 6");
  assert.equal(Packs.forgotCost(withPack(heavy), 3), "stress", "a bigger Pack fits it");
  const packless = Packs.carryStatus({ packs: [], stash: [] }, packsById, gear);
  assert.equal(Packs.forgotCost(packless, 1), "fate-point", "no Active Pack: nothing extra fits");
  assert.equal(Packs.forgotCost(packless, 0), "stress");
});

test("bundles bring their supplies, tracked per source; components are not sold alone", () => {
  const items = new Map([
    ["ration", { id: "ration", weight: 0, price: 0, marketplaceVisible: false }],
    ["rations-kit", { id: "rations-kit", weight: 1, price: 0, contents: [{ gearId: "ration", quantity: 5 }] }],
    ["crate", { id: "crate", weight: 3, contents: [{ gearId: "rations-kit", quantity: 2 }, { gearId: "rope", quantity: 1 }] }],
    ["loop", { id: "loop", weight: 1, contents: [{ gearId: "loop", quantity: 1 }] }],
    ["rope", { id: "rope", weight: 1 }]
  ]);
  assert.equal(Packs.isSoldAlone(items.get("ration")), false);
  assert.equal(Packs.isSoldAlone(items.get("rations-kit")), true);
  assert.deepEqual(Packs.bundleSupplies("crate", items), { ration: 10, rope: 1 }, "nested bundles expand to their supplies");
  assert.deepEqual(Packs.bundleSupplies("loop", items), {}, "a loop is cut, never followed");
  assert.deepEqual(Packs.bundleSupplies("rope", items), {}, "plain Gear supplies nothing extra");

  const pack = { id: "standard", carryLimit: 6, contents: [{ gearId: "ration", quantity: 5 }, { gearId: "rope", quantity: 1 }] };
  let kit = { gearId: "rations-kit", quantity: 1, broughtIntoAction: true };
  kit = Packs.adjustSupply(kit, "ration", -1, items);
  assert.deepEqual(Packs.stashSupplies(kit, items), [{ gearId: "ration", quantity: 4, capacity: 5 }]);
  assert.deepEqual(Packs.adjustSupply(kit, "ration", 1, items).used, undefined, "recovering it clears the count");
  assert.deepEqual(Packs.stashSupplies(Packs.adjustSupply(kit, "ration", -9, items), items), [{ gearId: "ration", quantity: 0, capacity: 5 }]);

  let owned = [Packs.newInstance(pack, "pack-1", true)];
  owned = [Packs.adjustItem(owned[0], "ration", -3)];
  const character = { packs: owned, stash: [kit, { gearId: "rope", quantity: 1, broughtIntoAction: false }] };
  const rations = Packs.suppliesOnHand(character, items).find((entry) => entry.gearId === "ration");
  assert.deepEqual([rations.quantity, rations.capacity], [6, 10], "Pack 2/5 + Rations Kit 4/5");
  assert.deepEqual(rations.sources.map((source) => `${source.source} ${source.quantity}/${source.capacity}`), ["pack 2/5", "rations-kit 4/5"]);
  const status = Packs.carryStatus(character, new Map([[pack.id, pack]]), items);
  assert.equal(status.carried, 1, "the kit weighs 1; its Rations and the Pack's don't count");
});

test("choosing a Sponsor writes its Extra into the Extras, and choosing another swaps it", () => {
  const verna = { name: "University of Verna", extraName: "Institutional Access", extraRule: "Gain **+1** Progress on Research." };
  const company = { name: "Nowhere Expeditions (the Company)", extraName: "Relocation Package", extraRule: "+1 Coin after each expedition." };
  let extras = Packs.applySponsorExtra("Spell list: none", null, verna);
  assert.equal(extras, "Recruitment Faction: University of Verna\nInstitutional Access: Gain +1 Progress on Research.\n\nSpell list: none");
  extras = Packs.applySponsorExtra(extras, verna, company);
  assert.equal(extras, "Recruitment Faction: Nowhere Expeditions (the Company)\nRelocation Package: +1 Coin after each expedition.\n\nSpell list: none");
  assert.equal(Packs.applySponsorExtra(extras, company, company), extras, "choosing it again adds nothing");
  assert.equal(Packs.applySponsorExtra(extras, company, null), "Spell list: none", "clearing the Sponsor removes its block");
  const edited = extras.replace("+1 Coin", "+1 Coin (house rule: +2)");
  assert.ok(Packs.applySponsorExtra(edited, company, verna).includes("house rule"), "an edited block is left to the player");
  assert.equal(Packs.applySponsorExtra("", null, { name: "Quiet", extraName: "", extraRule: "" }), "", "a Sponsor without an Extra writes nothing");
});

test("Armor boxes are marked instead of Physical Stress and stay marked", () => {
  const items = new Map([["breastplate", { id: "breastplate", weight: 2, armorBoxes: 2 }], ["rope", { id: "rope", weight: 1 }]]);
  let plate = { gearId: "breastplate", quantity: 1, broughtIntoAction: true };
  assert.deepEqual(Packs.armorStatus(plate, items), { boxes: 2, marked: 0 });
  plate = Packs.toggleArmorBox(plate, 0, items);
  assert.deepEqual(Packs.armorStatus(plate, items), { boxes: 2, marked: 1 });
  plate = Packs.toggleArmorBox(plate, 1, items);
  assert.equal(plate.armorMarked, 2);
  assert.equal(Packs.toggleArmorBox(plate, 0, items).armorMarked, undefined, "clicking the first marked box clears them (a repair)");
  assert.deepEqual(Packs.armorStatus({ gearId: "breastplate", armorMarked: 9 }, items), { boxes: 2, marked: 2 }, "never more than its boxes");
  assert.deepEqual(Packs.armorStatus({ gearId: "rope" }, items), { boxes: 0, marked: 0 }, "plain Gear has no boxes");
});

test("a Carry modifier from a stunt or situation adjusts the Active Pack's Carry Limit", () => {
  const stash = [{ gearId: "surveying-instruments", quantity: 3, broughtIntoAction: true }];   // weight 6
  const packs = [Packs.newInstance(university, "pack-1", true)];
  const status = (carryModifier) => Packs.carryStatus({ packs, stash, carryModifier }, packsById, gear);
  assert.deepEqual([status(2).packLimit, status(2).modifier, status(2).limit], [6, 2, 8]);
  assert.equal(Packs.forgotCost(status(2), 2), "stress", "6 + 2 fits a limit of 8");
  assert.equal(Packs.forgotCost(status(0), 2), "fate-point", "without the stunt it doesn't");
  assert.deepEqual([status(-2).limit, status(-2).over], [4, true], "a situation can lower it");
  assert.equal(status(-9).limit, 0, "never below 0");
  assert.equal(status("abc").limit, 6, "anything that isn't a number counts as 0");
  assert.equal(Packs.carryStatus({ packs: [], stash, carryModifier: 3 }, packsById, gear).limit, null, "no Active Pack: no limit to modify");
});

test("older sheets without Packs load as owning none", () => {
  assert.deepEqual(Packs.normalizeOwned(undefined), []);
  assert.deepEqual(Packs.normalizeOwned([null, { packId: 3 }, "rope"]), []);
  const status = Packs.carryStatus({ stash: [{ gearId: "rope", quantity: 2, broughtIntoAction: true }] }, packsById, gear);
  assert.deepEqual([status.limit, status.carried, status.over], [null, 2, true]);
});
