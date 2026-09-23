import { defineStore } from "pinia";

export type SidecarView = "toc" | "marks" | "settings";

/** Left sidebar: which panel it shows and whether it is expanded. */
export const useSidecar = defineStore("sidecar", {
  state: () => ({
    open: typeof window === "undefined" ? true : window.innerWidth > 760,
    view: "toc" as SidecarView,
  }),
  actions: {
    show(view: SidecarView): void {
      this.view = view;
      this.open = true;
    },
    hide(): void {
      this.open = false;
    },
    toggle(): void {
      this.open = !this.open;
    },
  },
});
