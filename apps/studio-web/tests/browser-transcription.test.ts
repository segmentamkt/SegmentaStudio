import assert from "node:assert/strict";
import test from "node:test";
import { timedCaptionCards } from "../lib/browser-transcription";

test("caption cards follow spoken word times and leave real pauses blank", () => {
  const cards = timedCaptionCards([
    { text: "¿A", startInSeconds: .3, endInSeconds: .48 },
    { text: "usted", startInSeconds: .51, endInSeconds: .83 },
    { text: "también?", startInSeconds: .88, endInSeconds: 1.2 },
    { text: "Fresco,", startInSeconds: 3.1, endInSeconds: 3.5 },
    { text: "nosotros", startInSeconds: 3.6, endInSeconds: 4 },
  ], 5, 4);
  assert.deepEqual(cards.map((card) => card.text), ["¿A usted también?", "Fresco, nosotros"]);
  assert.ok(cards[0].endSeconds < 2);
  assert.ok(cards[1].startSeconds >= 3);
});
