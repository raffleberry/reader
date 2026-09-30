import { describe, expect, it, vi } from "vitest";
import { ensureSection } from "../src/store/player";
import type { ReaderView } from "../src/foliate/render";

/**
 * Read-aloud navigation (ensureSection in src/store/player.ts): the player
 * must not navigate when the sentence's section is already on screen, must
 * navigate once on a section change, and must give up when nothing loads.
 * A fake viewer with real detached section documents drives the real
 * implementation.
 */

function docOf(html: string): Document {
  const d = document.implementation.createHTMLDocument("c");
  d.body.innerHTML = html;
  return d;
}

interface Nav {
  docText: string | null;
  gotos: number[];
}

async function navigate(
  mode: "visible" | "section" | "missing",
  section: number,
): Promise<Nav> {
  const sec0 = docOf("<p>First section opens here. Still the first section.</p>");
  const sec1 = docOf("<p>Second section begins now. It continues a while.</p>");

  const gotos: number[] = [];
  let live = mode === "section" ? 0 : section;
  const view = {
    contents: () => (mode === "missing" ? null : { index: live, doc: live === 0 ? sec0 : sec1 }),
    goTo: async ({ index }: { index: number }): Promise<void> => {
      gotos.push(index);
      if (mode === "missing") return;
      live = index;
    },
  } as unknown as ReaderView;

  const doc = await ensureSection(view, section, () => true);
  return { docText: doc ? (doc.body.textContent ?? "") : null, gotos };
}

describe("ensureSection", () => {
  it("does not navigate when the section is already on screen", async () => {
    const out = await navigate("visible", 0);
    expect(out.docText).toContain("First section opens here.");
    expect(out.gotos).toEqual([]);
  });

  it("navigates once on a section change", async () => {
    const out = await navigate("section", 1);
    expect(out.docText).toContain("Second section begins now.");
    expect(out.gotos).toEqual([1]);
  });

  it("gives up when no section ever loads", async () => {
    const out = await navigate("missing", 1);
    expect(out.docText).toBeNull();
    expect(out.gotos).toEqual([1]);
  });

  it("returns null with no viewer at all", async () => {
    expect(await ensureSection(null, 0, () => true)).toBeNull();
  });

  it("stops waiting when the run dies", async () => {
    const view = {
      contents: () => null,
      goTo: vi.fn(async () => undefined),
    } as unknown as ReaderView;
    const doc = await ensureSection(view, 3, () => false);
    expect(doc).toBeNull();
  });
});
