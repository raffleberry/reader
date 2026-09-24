import { createApp } from "vue";
import { createPinia } from "pinia";
import "bootstrap/dist/css/bootstrap.min.css";
import App from "./App.vue";
import router from "./router";
import { IS_DEMO } from "./demo";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount("#app");

// Demo only: cache the app shell so reading works offline. Books already
// live in IndexedDB; the server build has real URLs and needs no worker.
if (IS_DEMO && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
