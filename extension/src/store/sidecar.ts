import { ref } from "vue";
import { defineStore } from "pinia";

export type SidecarView = "toc" | "marks" | "settings";

/** Left sidebar: which panel it shows and whether it is expanded. */
export const useSidecar = defineStore("sidecar", () => {
  const open = ref(typeof window === "undefined" ? true : window.innerWidth > 760);
  const view = ref<SidecarView>("toc");

  function show(v: SidecarView): void {
    view.value = v;
    open.value = true;
  }

  function hide(): void {
    open.value = false;
  }

  function toggle(): void {
    open.value = !open.value;
  }

  return { open, view, show, hide, toggle };
});
