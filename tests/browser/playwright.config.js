const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.COMFY_URL ?? "http://127.0.0.1:8190",
    channel: "msedge",
    viewport: { width: 1400, height: 900 },
    screenshot: "only-on-failure",
  },
});
