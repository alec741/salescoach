import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:3107";
const routes = ["/manager", "/rep", "/rep/calls", "/rep/summaries", "/manager/reports", "/settings/users"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const results = [];

try {
  for (const route of routes) {
    const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const heading = await page.locator("h1, h2").first().textContent().catch(() => "");
    results.push({ route, status: response?.status() || 0, heading: heading?.trim() || null });
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ baseUrl, results }, null, 2));

if (!results.every((result) => result.status === 200 && result.heading)) {
  process.exitCode = 1;
}
