<template>
  <TopBar />
  <main class="container py-5">
    <div class="mb-4">
      <h1 class="display-6">Library</h1>
      <p class="lead text-body-secondary">Upload an <b>.epub</b> file to read and listen to it.</p>
    </div>

    <label class="upload-zone d-inline-block px-4 py-3 mb-1">
      <span class="fw-semibold">{{ busy ? "Uploading…" : "＋ Choose an EPUB" }}</span>
      <input type="file" accept=".epub" hidden :disabled="busy" @change="pick" />
    </label>

    <div v-if="store.error" class="alert alert-danger mt-3">{{ store.error }}</div>
    <p v-if="!store.loading && !store.books.length" class="mt-3 text-body-secondary">
      No books yet. Your uploads stay on this device.
    </p>

    <div class="row g-3 mt-1">
      <div v-for="b in store.books" :key="b.id" class="col-12 col-sm-6 col-lg-4">
        <BookCard :book="b" @drop="drop" />
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useReader } from "../store/reader";
import { newId, putBook } from "../db";
import { parseEpub } from "../text/epub";
import BookCard from "../components/BookCard.vue";
import TopBar from "../components/TopBar.vue";

const store = useReader();
const busy = ref(false);

onMounted(() => void store.loadAll());

async function pick(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = true;
  store.error = "";
  try {
    if (!file.name.toLowerCase().endsWith(".epub")) {
      throw new Error("only .epub is supported for now");
    }
    const parsed = await parseEpub(file);
    await putBook({
      id: newId(),
      title: parsed.title,
      size: file.size,
      created: Date.now(),
      blob: file,
      sentences: parsed.sentences,
    });
    await store.loadAll();
  } catch (err) {
    store.error = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function drop(id: string): Promise<void> {
  if (confirm("Delete this book from this device?")) await store.remove(id);
}
</script>
