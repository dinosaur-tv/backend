import assert from "node:assert/strict";
import test from "node:test";
import { decodeImagePayload } from "./media.js";

test("accepts a tiny jpeg payload", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x00]);
  const decoded = decodeImagePayload(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
  assert.equal(decoded[0], 0xff);
  assert.equal(decoded[1], 0xd8);
});

test("rejects an image that is not a photograph", () => {
  assert.throws(() => decodeImagePayload("data:image/gif;base64,R0lGODlh"), /JPEG|PNG|WebP|прочитать/i);
});
