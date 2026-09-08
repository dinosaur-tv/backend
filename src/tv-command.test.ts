import assert from "node:assert/strict";
import test from "node:test";
import { TvDesk } from "./tv-command.js";

test("queues a Kinopoisk launch for the television", () => {
  const desk = new TvDesk(() => 1_000);
  const command = desk.launch("kinopoisk");
  assert.equal(command.action, "launch");
  assert.equal(command.app, "kinopoisk");
  assert.equal(desk.snapshot().command?.at, "1970-01-01T00:00:01.000Z");
});

test("queues a remote key for the television", () => {
  const desk = new TvDesk();
  const command = desk.key("ok");
  assert.equal(command.action, "key");
  assert.equal(command.key, "ok");
});
