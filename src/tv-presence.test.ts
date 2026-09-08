import assert from "node:assert/strict";
import test from "node:test";
import { parseTvVisible, TvPresence } from "./tv-presence.js";

test("the living-room screen is online only while it is visible and recently seen", () => {
  let now = 1_000;
  const presence = new TvPresence(3_000, () => now);
  assert.equal(presence.online(), false);
  presence.touch(true);
  assert.equal(presence.online(), true);
  now = 3_500;
  assert.equal(presence.online(), true);
  now = 4_100;
  assert.equal(presence.online(), false);
  presence.touch(false);
  assert.equal(presence.online(), false);
});

test("old television clients without a visibility header still count as on-screen", () => {
  assert.equal(parseTvVisible(undefined), true);
  assert.equal(parseTvVisible("1"), true);
  assert.equal(parseTvVisible("0"), false);
});

test("the default grace window survives a slow calendar refresh", () => {
  let now = 1_000;
  const presence = new TvPresence(undefined, () => now);
  presence.touch(true);
  now += 8_000;
  assert.equal(presence.online(), true);
  now += 7_100;
  assert.equal(presence.online(), false);
});
