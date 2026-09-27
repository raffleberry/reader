import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";

/**
 * The toolbar button. Reader has no popup: a click opens the reader tab, or
 * focuses the one already open so a second click never stacks tabs.
 */
const lastTab = storage.defineItem<{ id: number; at: number }>("session:readerTab");

/** A tab id can be recycled, so only trust a recent one. */
const FRESH_MS = 10 * 60 * 1000;

export default defineBackground(() => {
  browser.action.onClicked.addListener(() => void openReader());
  browser.tabs.onRemoved.addListener((id) => void forget(id));
});

async function remember(id: number): Promise<void> {
  try {
    await lastTab.setValue({ id, at: Date.now() });
  } catch {
    // No session storage (older Firefox): every click opens a new tab.
  }
}

async function forget(id: number): Promise<void> {
  try {
    if ((await lastTab.getValue())?.id === id) await lastTab.removeValue();
  } catch {
    // Nothing to forget.
  }
}

async function openReader(): Promise<void> {
  const url = browser.runtime.getURL("/reader.html");
  const seen = await lastTab.getValue().catch(() => undefined);
  if (seen && Date.now() - seen.at < FRESH_MS) {
    try {
      const tab = await browser.tabs.get(seen.id);
      await browser.tabs.update(seen.id, { active: true });
      await browser.windows.update(tab.windowId ?? -1, { focused: true });
      return;
    } catch {
      // Tab is gone (or its id was reused): fall through and open a new one.
    }
  }
  const tab = await browser.tabs.create({ url });
  if (typeof tab.id === "number") await remember(tab.id);
}
