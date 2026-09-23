<template>
  <div>
    <p v-if="!reader.current" class="text-body-secondary small p-2">Open a book to see its bookmarks.</p>
    <p v-else-if="!marks.length" class="text-body-secondary small p-2">
      No bookmarks yet. Select text in the book to add one.
    </p>
    <nav v-else class="p-1">
      <div
        v-for="m in marks"
        :key="m.id"
        class="d-flex align-items-start gap-1 mb-1"
      >
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
import { onMounted, ref, watch } from "vue";
import type { Contents } from "epubjs";
import { deleteMark, listMarks } from "../db";
import type { Bookmark } from "../db";
import { useReader } from "../store/reader";
import { useSidecar } from "../store/sidecar";
import { findSentence, paint } from "../tts/locate";

const reader = useReader();
const car = useSidecar();
const marks = ref<Bookmark[]>([]);

async function reload(): Promise<void> {
  const id = reader.current?.id;
  marks.value = id ? await listMarks(id).catch(() => []) : [];
}

onMounted(() => void reload());

watch(
  () => [car.view, reader.current?.id] as const,
  (view) => {
    if (view[0] === "marks") void reload();
  },
);

/** Jump to the bookmarked sentence and flash it. */
async function jump(m: Bookmark): Promise<void> {
  const sent = reader.sentences.find((s) => s.key === m.key);
  const rendition = reader.rendition;
  if (!sent || !rendition) return;
  try {
    await rendition.display(sent.href);
  } catch {
    return;
  }
  const docs = (rendition.getContents() as unknown as Contents[])
    .map((c) => c.document)
    .filter((d): d is Document => !!d?.body);
  for (const doc of docs) {
    const found = findSentence(doc, sent.text);
    if (!found) continue;
    const unpaint = paint(found.range, "tts-sent").unpaint;
    found.range.startContainer.parentElement?.scrollIntoView({ block: "center" });
    window.setTimeout(unpaint, 1800);
    return;
  }
}

async function drop(id: string): Promise<void> {
  await deleteMark(id).catch(() => undefined);
  await reload();
}
</script>
