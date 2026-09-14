export function parseTvVisible(value?: string) {
  return value !== "0" && value !== "false";
}

/** A screen that says nothing about the permission is assumed able, as it always was. */
export function parseTvOverlay(value?: string) {
  return value !== "0" && value !== "false";
}

export class TvPresence {
  private seenAt = 0;
  private visible = false;
  /**
   * Whether this screen is allowed to draw over other apps. Without it «Поверх музыки»
   * cannot do anything at all, and used to fail in silence; the phone says so instead.
   */
  private overlay = true;

  // Snapshot refresh can occasionally spend a few seconds waiting for Google or weather.
  // Keep a generous grace window so the remote does not flicker offline between heartbeats.
  constructor(private readonly onlineMs = 15_000, private readonly now = () => Date.now()) {}

  touch(visible: boolean, overlay = true) {
    this.seenAt = this.now();
    this.visible = visible;
    this.overlay = overlay;
  }

  /** Only meaningful while the screen is answering; an absent one is not "forbidden". */
  canOverlay() {
    return this.overlay;
  }

  online() {
    return this.visible && this.now() - this.seenAt < this.onlineMs;
  }
}
