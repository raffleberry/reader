import { describe, expect, it } from "vitest";
import { speakable } from "../src/text/speak";

describe("speakable", () => {
  it.each(["****", "***", "* * *", "~~~", "···", "❦", "...", "—", "", "   "])(
    "rejects unspeakable %j",
    (text) => {
      expect(speakable(text)).toBe(false);
    },
  );

  it.each([
    "Hello world.",
    "Chapter 1",
    "42",
    "“Hi,” she said.",
    "café",
    "日本語の文です",
    "3 * 4 = 12",
  ])("accepts speakable %j", (text) => {
    expect(speakable(text)).toBe(true);
  });
});
