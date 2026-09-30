import { assertEquals } from "jsr:@std/assert@1.0.19";
import { slotsToBlock } from "./agenda.ts";

const grade = [
  "12:00:00",
  "14:00:00",
  "15:30:00",
  "16:00:00",
  "17:00:00",
  "18:00:00",
  "20:00:00",
  "21:00:00",
  "22:00:00",
];

Deno.test("evento 17h-21h bloqueia mesas que ainda estariam ocupadas e as do período", () => {
  assertEquals(slotsToBlock(grade, "17:00", 4, 120), [
    "15:30:00",
    "16:00:00",
    "17:00:00",
    "18:00:00",
    "20:00:00",
  ]);
});

Deno.test("evento de almoço não mexe na noite", () => {
  assertEquals(slotsToBlock(grade, "12:00", 3, 120), ["12:00:00", "14:00:00"]);
});
