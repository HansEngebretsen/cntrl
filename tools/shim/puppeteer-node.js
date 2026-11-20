// Stands in for @cloudflare/puppeteer while making the seed: a local headless Chromium (Playwright).
import { chromium } from 'playwright';
let shared = null;
const get = () => (shared ||= chromium.launch());
export async function closeAll() { if (shared) (await shared).close(); shared = null; }
export default {
  async sessions() { return []; },
  async connect() { throw new Error('no sessions'); },
  async launch() {
    const b = await get();
    return {
      async newPage() {
        const p = await b.newPage();
        return {
          setViewport: ({ width, height }) => p.setViewportSize({ width, height }),
          setContent: (h) => p.setContent(h, { waitUntil: 'networkidle', timeout: 15000 }),
          screenshot: (o) => p.screenshot({ type: 'png', clip: o.clip }),
          close: () => p.close(),
        };
      },
      disconnect() {},
      async close() {},
    };
  },
};
