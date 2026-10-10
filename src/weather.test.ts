import assert from "node:assert/strict";
import test from "node:test";
import {
  describeWeather, fallbackWeather, forecastUrl, offsetSuffix,
  periodsFromHourly, pickClosestHour, readForecast, upcomingHours, weekDaysFromForecast,
} from "./weather.js";
import { defaultPlace } from "./types.js";

const KAZAN = { name: "Казань", latitude: 55.7887, longitude: 49.1221, timezone: "Europe/Moscow" };
const VLADIVOSTOK = { name: "Владивосток", latitude: 43.1155, longitude: 131.8855, timezone: "Asia/Vladivostok" };

function hourlyFor(day: string, offsetHours: number) {
  const time: string[] = [];
  const temperature: number[] = [];
  const codes: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    time.push(`${day}T${String(hour).padStart(2, "0")}:00`);
    temperature.push(10 + hour * 0.5);
    codes.push(hour < 12 ? 0 : 3);
  }
  return { time, temperature, codes, offset: offsetSuffix(offsetHours * 3600) };
}

test("an offset comes back as the suffix a timestamp can be parsed with", () => {
  assert.equal(offsetSuffix(3 * 3600), "+03:00");
  assert.equal(offsetSuffix(10 * 3600), "+10:00");
  assert.equal(offsetSuffix(-5.5 * 3600), "-05:30");
  assert.equal(offsetSuffix(0), "+00:00");
  assert.equal(offsetSuffix(undefined), "+00:00");
});

test("named codes read in Russian, unknown ones say so", () => {
  assert.equal(describeWeather(0), "Ясно");
  assert.equal(describeWeather(65), "Сильный дождь");
  assert.equal(describeWeather(4242), "Нет данных");
  assert.equal(describeWeather(undefined), "Нет данных");
});

test("the closest hour wins, and a day with no readings returns nothing", () => {
  const hourly = hourlyFor("2026-09-13", 3);
  assert.equal(pickClosestHour(hourly, "2026-09-13", 13, hourly.offset)?.hour, 13);
  assert.equal(pickClosestHour(hourly, "2026-09-14", 13, hourly.offset), undefined);
});

test("four parts of the day, each with its own reading", () => {
  const hourly = hourlyFor("2026-09-13", 3);
  const periods = periodsFromHourly(hourly, "2026-09-13", hourly.offset);
  assert.deepEqual(periods.map((p) => p.label), ["Утро", "День", "Вечер", "Ночь"]);
  assert.deepEqual(periods.map((p) => p.hour), [8, 13, 19, 23]);
});

test("the hour strip starts at the present, not at midnight", () => {
  const hourly = hourlyFor("2026-09-13", 3);
  const hours = upcomingHours(hourly, new Date("2026-09-13T15:00:00+03:00"), hourly.offset, 4);
  assert.deepEqual(hours.map((h) => h.hour), [15, 16, 17, 18]);
});

test("a week of highs, lows and the day's own parts", () => {
  const hourly = hourlyFor("2026-09-13", 3);
  const days = weekDaysFromForecast(
    { time: ["2026-09-13", "2026-09-14"], high: [18, 20], low: [9, 11], codes: [0, 61] },
    hourly,
    hourly.offset,
  );
  assert.equal(days.length, 2);
  assert.deepEqual([days[0].high, days[0].low, days[0].description], [18, 9, "Ясно"]);
  assert.equal(days[1].description, "Небольшой дождь");
  assert.equal(days[0].periods.length, 4);
  assert.equal(days[1].periods.length, 0, "у второго дня почасовых данных нет");
});

test("the same payload reads correctly seven hours east of Moscow", () => {
  const now = new Date("2026-09-13T09:00:00+10:00");
  const hourly = hourlyFor("2026-09-13", 10);
  const data = {
    utc_offset_seconds: 10 * 3600,
    current: { temperature_2m: 12.4, apparent_temperature: 10.8, weather_code: 3 },
    daily: { time: ["2026-09-13"], temperature_2m_max: [17.6], temperature_2m_min: [8.2], weather_code: [3] },
    hourly: { time: hourly.time, temperature_2m: hourly.temperature, weather_code: hourly.codes },
  };
  const snapshot = readForecast(data, VLADIVOSTOK, now);
  assert.equal(snapshot.location, "Владивосток");
  assert.equal(snapshot.temperature, 12);
  assert.equal(snapshot.periods.length, 4);
  assert.equal(snapshot.hours[0]?.hour, 9);
});

test("the request carries the household's own coordinates and timezone", () => {
  const url = new URL(forecastUrl(KAZAN));
  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(url.searchParams.get("latitude"), "55.7887");
  assert.equal(url.searchParams.get("timezone"), "Europe/Moscow");
  assert.equal(new URL(forecastUrl(defaultPlace())).searchParams.get("timezone"), "Europe/Moscow");
});

test("the empty reading keeps the place name", () => {
  const empty = fallbackWeather("Казань");
  assert.equal(empty.location, "Казань");
  assert.equal(empty.description, "Нет данных");
  assert.deepEqual(empty.periods, []);
});
