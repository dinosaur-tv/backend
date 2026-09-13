import assert from "node:assert/strict";
import test from "node:test";
import { listNames, mergeShared, type TaggedEvent } from "./shared-events.js";

function copy(owner: string, color: string, over: Partial<TaggedEvent> = {}): TaggedEvent {
  return {
    id: `${owner}:x`,
    uid: "invite-77@google.com:2026-09-14T18:00:00+03:00",
    title: "Ужин у бабушки",
    start: "2026-09-14T18:00:00+03:00",
    end: "2026-09-14T20:00:00+03:00",
    calendarName: owner,
    ownerName: owner,
    color,
    allDay: false,
    ...over,
  };
}

test("приглашение показывается один раз и называет обоих", () => {
  const merged = mergeShared([copy("Миша", "#D1A466"), copy("Наташа", "#8EA77A")]);
  assert.equal(merged.length, 1, "на экране одно дело, а не два одинаковых");
  assert.equal(merged[0].ownerName, "Миша и Наташа");
  assert.deepEqual(merged[0].owners, [{ label: "Миша", color: "#D1A466" }, { label: "Наташа", color: "#8EA77A" }]);
  assert.equal(merged[0].color, "#D1A466", "точка берёт цвет того, кто в списке первый");
});

test("троих тоже перечисляет по-человечески", () => {
  const merged = mergeShared([copy("Миша", "#1"), copy("Наташа", "#2"), copy("Лиза", "#3")]);
  assert.equal(merged[0].ownerName, "Миша, Наташа и Лиза");
});

test("один человек, два своих календаря — всё равно один человек", () => {
  const merged = mergeShared([copy("Миша", "#D1A466"), copy("Миша", "#D1A466", { calendarName: "Работа" })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].ownerName, "Миша");
  assert.equal(merged[0].owners?.length, 1);
});

test("разные встречи не слипаются", () => {
  const merged = mergeShared([
    copy("Миша", "#1"),
    copy("Наташа", "#2", { uid: "other-99@google.com:2026-09-14T18:00:00+03:00", title: "Йога" }),
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((event) => event.ownerName).sort(), ["Миша", "Наташа"]);
});

test("занятия одной серии остаются отдельными днями", () => {
  const monday = copy("Миша", "#1", { uid: "weekly@google.com:2026-09-14T18:00:00+03:00" });
  const tuesday = copy("Миша", "#1", { uid: "weekly@google.com:2026-09-15T18:00:00+03:00", start: "2026-09-15T18:00:00+03:00" });
  assert.equal(mergeShared([monday, tuesday]).length, 2);
});

test("без общего идентификатора хватает совпадения названия и времени", () => {
  const merged = mergeShared([copy("Миша", "#1", { uid: "" }), copy("Наташа", "#2", { uid: "" })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].ownerName, "Миша и Наташа");
});

test("одинаковое название в разное время — два разных дела", () => {
  const merged = mergeShared([
    copy("Миша", "#1", { uid: "" }),
    copy("Наташа", "#2", { uid: "", start: "2026-09-14T21:00:00+03:00" }),
  ]);
  assert.equal(merged.length, 2);
});

test("список возвращается по времени, как его и читают", () => {
  const merged = mergeShared([
    copy("Миша", "#1", { uid: "b", start: "2026-09-14T20:00:00+03:00" }),
    copy("Наташа", "#2", { uid: "a", start: "2026-09-14T09:00:00+03:00" }),
  ]);
  assert.deepEqual(merged.map((event) => event.start), ["2026-09-14T09:00:00+03:00", "2026-09-14T20:00:00+03:00"]);
});

test("перечисление имён", () => {
  assert.equal(listNames([]), "");
  assert.equal(listNames(["Миша"]), "Миша");
  assert.equal(listNames(["Миша", "Наташа"]), "Миша и Наташа");
});
