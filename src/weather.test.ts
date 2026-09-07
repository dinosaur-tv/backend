import assert from "node:assert/strict";
import test from "node:test";
import { periodsFromHourly, pickClosestHour, upcomingHours } from "./weather.js";

const hourly = {
  time: [
    "2026-09-07T07:00",
    "2026-09-07T08:00",
    "2026-09-07T13:00",
    "2026-09-07T19:00",
    "2026-09-07T23:00",
    "2026-09-07T23:00",
  ],
  temperature: [9, 11, 16, 12, 8, 8],
  codes: [2, 1, 0, 3, 45, 45],
};

test("picks morning, day, evening and night for the today view", () => {
  const periods = periodsFromHourly(hourly, "2026-09-07");
  assert.deepEqual(periods.map((item) => [item.id, item.temperature, item.label]), [
    ["morning", 11, "Утро"],
    ["day", 16, "День"],
    ["evening", 12, "Вечер"],
    ["night", 8, "Ночь"],
  ]);
});

test("finds the closest hour when the exact slot is missing", () => {
  const match = pickClosestHour({
    time: ["2026-09-07T09:00"],
    temperature: [10],
    codes: [61],
  }, "2026-09-07", 8);
  assert.equal(match?.temperature, 10);
  assert.match(match?.description ?? "", /дождь/i);
});

test("keeps the next few hours for the weather strip", () => {
  const hours = upcomingHours(hourly, new Date("2026-09-07T12:30:00Z"), 3);
  assert.ok(hours.length <= 3);
  assert.ok(hours.every((item) => item.time.startsWith("2026-09-07")));
});
