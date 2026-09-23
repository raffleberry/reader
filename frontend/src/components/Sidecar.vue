<template>
  <aside class="sidecar" :class="{ collapsed: !car.open }" aria-label="Sidebar">
    <div v-if="car.open" class="sidecar-open">
      <div class="sidecar-head">
        <div class="btn-group btn-group-sm" role="group" aria-label="Sidebar view">
          <button
            class="btn"
            :class="car.view === 'toc' ? 'btn-secondary' : 'btn-outline-secondary'"
            title="Table of contents"
            @click="car.show('toc')"
          >
            ☰ Contents
          </button>
          <button
            class="btn"
            :class="car.view === 'marks' ? 'btn-secondary' : 'btn-outline-secondary'"
            title="Bookmarks"
            @click="car.show('marks')"
          >
            🔖 Marks
          </button>
          <button
            class="btn"
            :class="car.view === 'settings' ? 'btn-secondary' : 'btn-outline-secondary'"
            title="Settings"
            @click="car.show('settings')"
          >
            ⚙ Settings
          </button>
        </div>
        <button class="btn btn-outline-secondary btn-sm" title="Hide sidebar" @click="car.hide()">«</button>
      </div>
      <div class="sidecar-body">
        <TocList
          v-if="car.view === 'toc'"
          :toc="reader.toc"
          :current="reader.chapterHref"
          @go="goToc"
        />
        <BookmarksPanel v-else-if="car.view === 'marks'" />
        <SettingsPanel v-else />
      </div>
    </div>
    <div v-else class="sidecar-rail">
      <button class="btn btn-outline-secondary btn-sm" title="Show sidebar" @click="car.toggle()">»</button>
      <button class="btn btn-outline-secondary btn-sm" title="Table of contents" @click="car.show('toc')">☰</button>
      <button class="btn btn-outline-secondary btn-sm" title="Bookmarks" @click="car.show('marks')">🔖</button>
      <button class="btn btn-outline-secondary btn-sm" title="Settings" @click="car.show('settings')">⚙</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useReader } from "../store/reader";
import { useSidecar } from "../store/sidecar";
import TocList from "./TocList.vue";
import BookmarksPanel from "./BookmarksPanel.vue";
import SettingsPanel from "./SettingsPanel.vue";

const reader = useReader();
const car = useSidecar();

/** Jump the open rendition to a TOC href (same resolution as before). */
function goToc(href: string): void {
  const rendition = reader.rendition;
  if (rendition) void rendition.display(href).catch(() => undefined);
}
</script>
