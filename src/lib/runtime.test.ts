import { describe, expect, it } from "vitest";
import { formatRuntime } from "./runtime";

describe("formatRuntime", () => {
  it("formats minutes under an hour", () => {
    expect(formatRuntime(45)).toBe("45m");
  });

  it("formats whole hours", () => {
    expect(formatRuntime(120)).toBe("2h");
  });

  it("formats hours with remaining minutes", () => {
    expect(formatRuntime(102)).toBe("1h 42m");
  });
});
