import type { EventOwner, SnapshotEvent } from "./types.js";

/** An event as one calendar reported it, still carrying the id Google gives every copy. */
export type TaggedEvent = SnapshotEvent & { uid: string };

/**
 * When one person makes an event and invites another, it lands in both their calendars,
 * and the screen used to show it twice. Google gives every copy the same iCalUID, so the
 * copies can be folded back into the one thing they describe — named for everyone who has
 * it. Events with no shared id are only folded together when they agree on title and time,
 * which in a household means the same dinner written down twice.
 */
export function mergeShared(events: TaggedEvent[]): SnapshotEvent[] {
  const groups = new Map<string, TaggedEvent[]>();
  for (const event of events) {
    const key = event.uid || `${event.title}|${event.start}|${event.end}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()].map((copies) => {
    const [first] = copies;
    const owners: EventOwner[] = [];
    for (const copy of copies) {
      // One person keeping it in two of their own calendars is still one person.
      if (!owners.some((owner) => owner.label === copy.ownerName)) owners.push({ label: copy.ownerName, color: copy.color });
    }
    const event: SnapshotEvent & { uid?: string } = { ...first, ownerName: listNames(owners.map((owner) => owner.label)), owners };
    delete event.uid;
    return event;
  }).sort((a, b) => a.start.localeCompare(b.start));
}

/** «Миша и Наташа», «Миша, Наташа и Лиза» — read aloud the way anyone would say it. */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}
