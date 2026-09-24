import { createRouter, createWebHashHistory, createWebHistory } from "vue-router";
import Library from "./views/Library.vue";
import Reader from "./views/Reader.vue";
import { IS_DEMO } from "./demo";

export default createRouter({
  // Demo is a static file host with no URL rewrites: hash history keeps
  // every route on index.html so refresh/bookmarks always load. The server
  // build keeps clean history URLs (server falls back to index.html).
  history: IS_DEMO ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: "/", name: "library", component: Library },
    { path: "/read/:id", name: "reader", component: Reader, props: true },
  ],
});
