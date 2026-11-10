import assert from "node:assert/strict";
import test from "node:test";
import { actionsFromToolCalls, answer, cleanPhrase, understand } from "./assistant.js";

const noKey = { model: "test", baseUrl: "https://ai.example.test/v1" };

test("Джарвис понимает обычные команды без модели", () => {
  const kinds = (text: string) => understand(text)?.actions.map((action) => JSON.stringify(action));
  assert.deepEqual(kinds("Джарвис, включи музыку"), [JSON.stringify({ kind: "launch", app: "yandex_music" }), JSON.stringify({ kind: "music", action: "start" })]);
  assert.deepEqual(kinds("пауза"), [JSON.stringify({ kind: "music", action: "pause" })]);
  assert.deepEqual(kinds("следующую песню"), [JSON.stringify({ kind: "music", action: "next" })]);
  assert.deepEqual(kinds("сделай громче"), [JSON.stringify({ kind: "volume", direction: "up" })]);
  assert.deepEqual(kinds("громкость на 40"), [JSON.stringify({ kind: "volume_set", level: 40 })]);
  assert.deepEqual(kinds("открой рутуб"), [JSON.stringify({ kind: "launch", app: "rutube" })]);
  assert.deepEqual(kinds("Джарвис, погаси экран"), [JSON.stringify({ kind: "screen", power: "off" })]);
  assert.equal(understand("какая завтра погода?"), null, "a question goes to the model");
  assert.equal(cleanPhrase("Джарвис, Включи ЁЛКУ!"), "включи елку");
});

test("вызовы функций модели становятся действиями, мусор отбрасывается", () => {
  const call = (name: string, args: object | string) => ({ function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
  assert.deepEqual(actionsFromToolCalls([
    call("open_app", { app: "kinopoisk" }),
    call("open_app", { app: "steam" }),
    call("music", { action: "start" }),
    call("volume", { level: 150 }),
    call("screen", { power: "off" }),
    call("type_text", "{broken"),
  ]), [
    { kind: "launch", app: "kinopoisk" },
    { kind: "launch", app: "yandex_music" },
    { kind: "music", action: "start" },
    { kind: "volume_set", level: 100 },
    { kind: "screen", power: "off" },
  ]);
});

test("без ключа честно говорит, что умный режим не подключён", async () => {
  const result = await answer("сколько лететь до Луны?", noKey);
  assert.equal(result.source, "none");
  assert.deepEqual(result.actions, []);
});

test("с ключом спрашивает модель и возвращает её ответ и действия", async () => {
  let sent: { model?: string; messages?: { role: string; content: string }[] } = {};
  const fake = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: "**Включаю** Кинопоиск.", tool_calls: [{ function: { name: "open_app", arguments: "{\"app\":\"kinopoisk\"}" } }] } }] }));
  }) as typeof fetch;
  const result = await answer("Джарвис, хочу посмотреть фильм", { ...noKey, apiKey: "k" }, fake);
  assert.equal(sent.model, "test");
  assert.equal(sent.messages?.at(-1)?.content, "хочу посмотреть фильм");
  assert.deepEqual(result, { reply: "Включаю Кинопоиск.", actions: [{ kind: "launch", app: "kinopoisk" }], source: "ai" });
});
