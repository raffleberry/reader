import { createRouter, createWebHistory } from "vue-router";
import Library from "./views/Library.vue";
import Reader from "./views/Reader.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "library", component: Library },
    { path: "/read/:id", name: "reader", component: Reader, props: true },
  ],
});
