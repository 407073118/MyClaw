export default defineNuxtConfig({
  devtools: { enabled: true },
  css: ["~/assets/css/main.css"],
  runtimeConfig: {
    cloudApiBase: process.env.CLOUD_API_BASE ?? "http://127.0.0.1:43210"
  },
  compatibilityDate: "2026-03-20"
});
