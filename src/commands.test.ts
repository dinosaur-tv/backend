import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramCommand } from "./commands.js";
import type { StoredState } from "./types.js";

function blankState(): StoredState {
  return { oauth: {}, display: { mode: "NOW", theme: "gallery", mood: "home", privacy: false, showWeather: true, showCalendar: true, rotation: { enabled: true, now: 30, today: 30, week: 30 } } };
}

test("switches the living-room screen and explains it warmly", () => {
  const state = blankState();
  const reply = handleTelegramCommand("/today", (mutator) => {
    mutator(state);
    return state;
  }, { misha: true, natasha: false });
  assert.equal(state.display.mode, "TODAY");
  assert.match(reply.text, /Сегодня/);
});

test("retires the month view instead of showing it", () => {
  const state = blankState();
  const reply = handleTelegramCommand("/month", (mutator) => {
    mutator(state);
    return state;
  }, { misha: false, natasha: false });
  assert.equal(state.display.mode, "WEEK");
  assert.match(reply.text, /неделю/i);
});

test("puts night and play on their own mood, not the color theme", () => {
  const state = blankState();
  const reply = handleTelegramCommand("/theme play", (mutator) => {
    mutator(state);
    return state;
  }, { misha: true, natasha: true });
  assert.equal(state.display.mood, "play");
  assert.equal(state.display.theme, "gallery");
  assert.match(reply.text, /шалость/i);
});

test("switches to a fully designed environment scene", () => {
  const state = blankState();
  const reply = handleTelegramCommand("/theme mountains", (mutator) => {
    mutator(state);
    return state;
  }, { misha: true, natasha: true });
  assert.equal(state.display.theme, "mountains");
  assert.equal(state.display.mood, "home");
  assert.match(reply.text, /Горы/);
});

test("switches to a city scene with a human name", () => {
  const state = blankState();
  const reply = handleTelegramCommand("/theme petersburg", (mutator) => {
    mutator(state);
    return state;
  }, { misha: true, natasha: true });
  assert.equal(state.display.theme, "petersburg");
  assert.match(reply.text, /Петербург/);
});

test("switches to a pattern scene", () => {
  const state = blankState();
  const reply = handleTelegramCommand("/theme byzantium", (mutator) => {
    mutator(state);
    return state;
  }, { misha: true, natasha: true });
  assert.equal(state.display.theme, "byzantium");
  assert.match(reply.text, /Византия/);
});

test("opens the mini app from start without a bottom keyboard payload", () => {
  const reply = handleTelegramCommand("/start", (mutator) => {
    mutator(blankState());
    return blankState();
  }, { misha: true, natasha: true });
  assert.equal(reply.openMiniApp, true);
  assert.match(reply.text, /консоль/i);
});
