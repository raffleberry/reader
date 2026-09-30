<template>
  <div>
    <p v-if="!reader.book" class="text-body-secondary small p-2">Open a book to see its bookmarks.</p>
    <p v-else-if="!marks.length" class="text-body-secondary small p-2">
      No bookmarks yet. Select text in the book to add one.
    </p>
    <nav v-else class="p-1">
      <div v-for="m in marks" :key="m.id" class="d-flex align-items-start gap-1 mb-1">
        <button
          class="btn btn-sm btn-link text-body text-start text-decoration-none text-truncate flex-grow-1"
          :title="m.text"
          @click="jump(m)"
        >
          {{ m.text }}
        </button>
        <button
          class="btn btn-sm btn-outline-danger flex-shrink-0"
          title="Delete bookmark"
          @click="drop(m.id)"
        >
          ✕
        </button>
      </div>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import { dropMark, listMarks, watchBook } from "../ext/marks";
import type { Mark } from "../ext/marks";
import { useReader } from "../store/reader";
import { ensureSection } from "../store/player";
import { rangeOfSentence, sectionStart } from "../text/sentences";
import { paint } from "../tts/locate";
import { SENT_CLS } from "../tts/mark";

/** How long the sentence stays flashed after a jump. */
const FLASH_MS = 1800;

const reader = useReader();
const marks = ref<Mark[]>([]);
/** The book the list belongs to; a new book means a new list. */
const book = ref("");
let stop: (() => void) | null = null;

/**
 * Read the list once, then follow storage: a bookmark made from the selection
 * popup has to appear here without closing the panel.
 */
function follow(id: string): void {
  stop?.();
  stop = null;
  marks.value = [];
  book.value = id;
  if (!id) return;
  void listMarks(id).then((list) => {
    if (book.value === id) marks.value = list;
  });
  stop = watchBook(id, (list) => {
    if (book.value === id) marks.value = list;
  });
}

/**
 * Jump to the bookmarked sentence and flash it. Display and paging are the
 * read-aloud path, so a bookmark in a long chapter scrolls the same way
 * narration does. The flash is painted here rather than through `tts/mark`,
 * so it can't collide with the highlight playback owns.
 */
async function jump(m: Mark): Promise<void> {
  const sent = reader.sentences[m.sent];
  const view = reader.view;
  if (!sent || !view) return;
  // Give up if the book changes under us: paging on would be wandering.
  const doc = await ensureSection(view, sent.chapter, () => reader.book?.id === book.value);
  if (!doc) return;
  const range = rangeOfSentence(doc, m.sent - sectionStart(reader.sentences, m.sent));
  if (!range) return;
  const { el, unpaint } = paint(range, SENT_CLS);
  el.scrollIntoView({ block: "center" });
  window.setTimeout(unpaint, FLASH_MS);
}

async function drop(id: string): Promise<void> {
  await dropMark(id).catch(() => undefined);
}

watch(() => reader.book?.id ?? "", follow, { immediate: true });

onUnmounted(() => {
  stop?.();
  stop = null;
});
</script>
