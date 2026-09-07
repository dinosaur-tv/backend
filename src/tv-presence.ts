export function parseTvVisible(value?: string) {
  return value !== "0" && value !== "false";
}

export class TvPresence {
  private seenAt = 0;
  private visible = false;

  constructor(private readonly onlineMs = 3_000, private readonly now = () => Date.now()) {}

  touch(visible: boolean) {
    this.seenAt = this.now();
    this.visible = visible;
  }

  online() {
    return this.visible && this.now() - this.seenAt < this.onlineMs;
  }
}
