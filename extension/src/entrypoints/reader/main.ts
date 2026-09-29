/**
 * Reader page (unlisted in the manifest, opened by the toolbar button).
 * Settings come from extension storage and are read before the first
 * render, so no component ever paints a default it then has to correct.
 */
import { createApp } from "vue";
import { createPinia } from "pinia";
import "bootstrap/dist/css/bootstrap.min.css";
import "../../assets/app.css";
import App from "../../App.vue";
import { hydrate } from "../../store/prefs";

async function start(): Promise<void> {
  const app = createApp(App);
  app.use(createPinia());
  await hydrate();
  app.mount("#app");
}

void start();
