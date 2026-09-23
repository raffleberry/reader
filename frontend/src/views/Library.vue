<template>
  <TopBar />
  <main class="container py-4">
    <h1>Library</h1>
    <p class="text-muted">Upload an <b>.epub</b> file to read and listen to it.</p>

    <label class="btn btn-outline-primary mb-1">
      {{ busy ? "Uploading…" : "Choose an EPUB" }}
      <input type="file" accept=".epub" hidden :disabled="busy" @change="pick" />
    </label>

    <div v-if="store.error" class="alert alert-danger mt-3">{{ store.error }}</div>
    <p v-if="!store.loading && !store.books.length" class="mt-3">No books yet.</p>

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
import BookCard from "../components/BookCard.vue";
import TopBar from "../components/TopBar.vue";

const store = useReader();
const busy = ref(false);

onMounted(() => void store.loadAll());

async function pick(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  busy.value = true;
  await store.add(file);
  busy.value = false;
  input.value = "";
}

async function drop(id: string): Promise<void> {
  if (confirm("Delete this book?")) await store.remove(id);
}
</script>
