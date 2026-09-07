import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramCommand } from "./commands.js";
import type { StoredState } from "./types.js";

function blankState(): StoredState {
  return { oauth: {}, display: { mode: "NOW", theme: "gallery", privacy: false } };
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

test("opens the mini app from start without a bottom keyboard payload", () => {
  const reply = handleTelegramCommand("/start", (mutator) => {
    mutator(blankState());
    return blankState();
  }, { misha: true, natasha: true });
  assert.equal(reply.openMiniApp, true);
  assert.match(reply.text, /консоль/i);
});
