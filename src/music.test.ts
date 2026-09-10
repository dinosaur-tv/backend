import assert from "node:assert/strict";
import test from "node:test";
import { heardNowPlaying, MusicDesk } from "./music.js";

test("music remote stays quiet until the television hears a track", () => {
  const desk = new MusicDesk();
  assert.equal(desk.snapshot().connected, false);
  assert.equal(desk.snapshot().nowPlaying, undefined);
});

test("shows the track the television is actually playing", () => {
  let now = 1_000;
  const desk = new MusicDesk(undefined, () => now);
  desk.hearFromTv({
    title: " Sweet Harmony ",
    artist: "Pete Tong",
    source: "Яндекс Музыка",
    isPlaying: true,
    volumePercent: 40,
    artworkUrl: "data:image/jpeg;base64,aaaa",
    deviceName: "Телевизор",
  });
  assert.equal(desk.snapshot().connected, true);
  assert.equal(desk.snapshot().nowPlaying?.title, "Sweet Harmony");
  assert.equal(desk.snapshot().nowPlaying?.artworkUrl, "");
  now = 22_000;
  assert.equal(desk.snapshot().nowPlaying, undefined);
});

test("keeps the last volume when the television omits it", () => {
  const desk = new MusicDesk();
  desk.hearFromTv({ title: "GANG", artist: "Индаблэк", isPlaying: true, volumePercent: 40 });
  desk.hearFromTv({ title: "GANG", artist: "Индаблэк", isPlaying: true });
  assert.equal(desk.snapshot().nowPlaying?.volumePercent, 40);
});

test("an empty report from the television clears the desk after it goes stale", () => {
  let now = 1_000;
  const desk = new MusicDesk(undefined, () => now);
  desk.hearFromTv({ title: "GANG", artist: "Индаблэк", isPlaying: true });
  desk.hearFromTv({ title: "  " });
  assert.equal(desk.snapshot().nowPlaying?.title, "GANG");
  now = 22_000;
  desk.hearFromTv({ title: "  " });
  assert.equal(desk.snapshot().nowPlaying, undefined);
});

test("keeps http artwork and drops data urls", () => {
  assert.equal(heardNowPlaying({ title: "A", artworkUrl: "https://cdn.example/cover.jpg" })?.artworkUrl, "https://cdn.example/cover.jpg");
  assert.equal(heardNowPlaying({ title: "A", artworkUrl: "data:image/jpeg;base64,xx" })?.artworkUrl, "");
  assert.equal(heardNowPlaying({ title: "" }), undefined);
});

test("queues transport for the television while a track is live", async () => {
  const desk = new MusicDesk();
  desk.hearFromTv({ title: "GANG", artist: "Индаблэк", isPlaying: true, volumePercent: 50 });
  const paused = await desk.command("toggle");
  assert.equal(paused.nowPlaying?.isPlaying, false);
  assert.equal(paused.command?.action, "toggle");
  const volume = await desk.command("volume", 20);
  assert.equal(volume.nowPlaying?.volumePercent, 20);
});

test("toTv does not pretend to move a phone track", async () => {
  const desk = new MusicDesk();
  const quiet = await desk.command("toTv");
  assert.equal(quiet.nowPlaying, undefined);
});

test("asks to start Kinopoisk when nothing is playing on the television", async () => {
  const desk = new MusicDesk();
  await assert.rejects(() => desk.command("toggle"), /Кинопоиске/);
});
