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

test("text, pointer, scroll and click reach the screen; long text and wild swipes are clipped", () => {
  const desk = new TvDesk(() => 1_000);
  assert.deepEqual(desk.text("x".repeat(500)), { action: "text", text: "x".repeat(200), at: "1970-01-01T00:00:01.000Z#0001" });
  assert.deepEqual(desk.pointer(12.6, -99_999), { action: "pointer", dx: 13, dy: -2000, at: "1970-01-01T00:00:01.000Z#0002" });
  assert.deepEqual(desk.scroll(-3), { action: "scroll", dy: -3, at: "1970-01-01T00:00:01.000Z#0003" });
  assert.deepEqual(desk.click("right"), { action: "click", button: "right", at: "1970-01-01T00:00:01.000Z#0004" });
});

test("a waiting screen is answered the moment something is pressed, and only with what is new", async () => {
  const desk = new TvDesk(() => 1_000);
  const first = desk.key("up");
  const waiting = desk.wait(first.at, 5_000);
  const started = Date.now();
  setTimeout(() => desk.pointer(5, 0), 20);
  const commands = await waiting;
  assert.ok(Date.now() - started < 1_000, "answered on the press, not at the timeout");
  assert.deepEqual(commands.map((command) => command.action), ["pointer"]);
  assert.deepEqual(await desk.wait("", 10), desk.snapshot().commands, "nothing seen yet: everything is new");
  assert.deepEqual(await desk.wait(desk.snapshot().commands.at(-1)!.at, 10), [], "timeout with nothing new");
});
