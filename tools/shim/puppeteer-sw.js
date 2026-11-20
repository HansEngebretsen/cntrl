// Stands in for @cloudflare/puppeteer in the demo's service worker: the page draws the HTML
// (client.js) and sends back an 800×480 PNG, which the real 1-bit conversion then uses.
const page = () => {
  let html = '';
  return {
    async setViewport() {},
    async setContent(h) { html = h; },
    async screenshot() { return self.cntrlRaster(html); },
    async close() {},
  };
};
const browser = () => ({ newPage: async () => page(), disconnect() {}, async close() {} });
export default {
  async sessions() { return []; },
  async connect() { throw new Error('no sessions'); },
  async launch() { return browser(); },
};
