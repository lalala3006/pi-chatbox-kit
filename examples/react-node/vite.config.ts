import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { port: 3000, proxy: { "/api/chatbox": `http://127.0.0.1:${process.env.CHATBOX_DEMO_API_PORT ?? 3001}` } },
});
