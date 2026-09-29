/** Options page: the same settings panel the reader's sidebar shows. */
import { createApp } from "vue";
import { createPinia } from "pinia";
import "bootstrap/dist/css/bootstrap.min.css";
import "../../assets/app.css";
import Options from "../../views/Options.vue";
import { hydrate } from "../../store/prefs";

async function start(): Promise<void> {
  const app = createApp(Options);
  app.use(createPinia());
  await hydrate();
  app.mount("#app");
}

void start();
