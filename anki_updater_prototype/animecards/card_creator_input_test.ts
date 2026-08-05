import { assertEquals } from "@std/assert";
import type { JMDictWord } from "data";
import { cardCreatorInputForAcceptedReadings } from "./card_creator_input.ts";

function entry(id: string): JMDictWord {
  return { id } as JMDictWord;
}

Deno.test("cardCreatorInputForAcceptedReadings separates readings and unique entry usages", () => {
  const first = entry("2000000");
  const second = entry("1000000");
  assertEquals(
    cardCreatorInputForAcceptedReadings([{
      entry: first,
      kanaReading: "ひとつ",
      applicableSenseNumbers: [2],
    }, {
      entry: first,
      kanaReading: "ふたつ",
      applicableSenseNumbers: [1, 2],
    }, {
      entry: second,
      kanaReading: "ふたつ",
      applicableSenseNumbers: [1],
    }]),
    {
      jmdictUsages: [{ entry: first, applicableSenseNumbers: [1, 2] }, {
        entry: second,
        applicableSenseNumbers: [1],
      }],
      kanaReadings: ["ひとつ", "ふたつ"],
    },
  );
});
