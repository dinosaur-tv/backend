import assert from "node:assert/strict";
import test from "node:test";
import { TvDesk } from "./tv-command.js";

test("queues a Kinopoisk launch for the television", () => {
  const desk = new TvDesk(() => 1_000);
  const command = desk.launch("kinopoisk");
  assert.equal(command.action, "launch");
  assert.equal(command.app, "kinopoisk");
  assert.equal(command.at, "1970-01-01T00:00:01.000Z#0001");
  assert.equal(desk.snapshot().command?.at, "1970-01-01T00:00:01.000Z#0001");
});

test("queues a remote key for the television", () => {
  const desk = new TvDesk();
  const command = desk.key("ok");
  assert.equal(command.action, "key");
  assert.equal(command.key, "ok");
});

test("keeps a FIFO of pad keys so rapid taps are not lost", () => {
  let t = 1_000;
  const desk = new TvDesk(() => t, 3);
  desk.key("up");
  t = 1_001;
  desk.key("up");
  t = 1_002;
  desk.key("ok");
  t = 1_003;
  desk.key("down");
  assert.deepEqual(
    desk.snapshot().commands.map((item) => [item.action === "key" ? item.key : item.action, item.at]),
    [
      ["up", "1970-01-01T00:00:01.001Z#0002"],
      ["ok", "1970-01-01T00:00:01.002Z#0003"],
      ["down", "1970-01-01T00:00:01.003Z#0004"],
    ],
  );
});
