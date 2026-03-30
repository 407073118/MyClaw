import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { router } from "./router";
import { useDesktopAuthStore } from "./stores/auth";
import "./style.css";

const pinia = createPinia();
const app = createApp(App);

useDesktopAuthStore(pinia).hydrateFromStorage();

app.use(pinia).use(router).mount("#app");
