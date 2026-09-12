import assert from "node:assert/strict";
import test from "node:test";
import { defaultPlace, normalizePlace } from "./types.js";

test("a place needs a name, a real point on the globe and a usable timezone", () => {
  const good = normalizePlace({ name: "  Казань  ", latitude: 55.78874, longitude: 49.12214, timezone: "Europe/Moscow" });
  assert.deepEqual(good, { name: "Казань", latitude: 55.7887, longitude: 49.1221, timezone: "Europe/Moscow" });

  for (const bad of [
    undefined, null, "Казань", {},
    { name: "", latitude: 10, longitude: 10, timezone: "Europe/Moscow" },
    { name: "Где-то", latitude: 91, longitude: 10, timezone: "Europe/Moscow" },
    { name: "Где-то", latitude: 10, longitude: -181, timezone: "Europe/Moscow" },
    { name: "Где-то", latitude: "рядом", longitude: 10, timezone: "Europe/Moscow" },
    { name: "Где-то", latitude: 10, longitude: 10, timezone: "" },
    { name: "Где-то", latitude: 10, longitude: 10, timezone: "Не/Зона" },
  ]) {
    assert.equal(normalizePlace(bad), undefined, JSON.stringify(bad));
  }
});

test("the default place is itself valid, so a fresh home always has somewhere to look", () => {
  assert.deepEqual(normalizePlace(defaultPlace()), defaultPlace());
});
