import assert from "node:assert/strict";
import test from "node:test";
import { MusicDesk } from "./music.js";

test("music remote stays quiet until a Yandex token is configured", () => {
  const desk = new MusicDesk();
  assert.equal(desk.snapshot().connected, false);
  assert.equal(desk.snapshot().nowPlaying, undefined);
});

test("asks to pick the television in Yandex Music itself", async () => {
  const desk = new MusicDesk();
  await assert.rejects(() => desk.command("toTv"), /Кинопоиск/);
});
