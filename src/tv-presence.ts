export function parseTvVisible(value?: string) {
  return value !== "0" && value !== "false";
}

export class TvPresence {
  private seenAt = 0;
  private visible = false;

  // Snapshot refresh can occasionally spend a few seconds waiting for Google or weather.
  // Keep a generous grace window so the remote does not flicker offline between heartbeats.
  constructor(private readonly onlineMs = 15_000, private readonly now = () => Date.now()) {}

  touch(visible: boolean) {
    this.seenAt = this.now();
    this.visible = visible;
  }

  online() {
    return this.visible && this.now() - this.seenAt < this.onlineMs;
  }
}
