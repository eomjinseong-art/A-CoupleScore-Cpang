import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const repo = process.cwd();
const sheetUrl = 'https://docs.google.com/spreadsheets/d/1l7niiK9RbZwo_x0PI6T2vCqjIKn9c_gvxVrrKjwyo20/gviz/tq?tqx=out:csv&sheet=%EA%B4%91%EA%B3%A0%EC%9A%A9';
const csv = await (await fetch(sheetUrl)).text();
const rows = parseCsv(csv);
const headers = rows[0].map(value => value.trim().toLowerCase());
const index = name => headers.indexOf(name);
const linkIndex = firstIndex(index, ['쿠팡 파트너스 링크', '쿠팡파트너스 링크', '상품 링크']);
const categoryIndex = firstIndex(index, ['상황 태그', '카테고리']);
const titleIndex = firstIndex(index, ['상품명', '실제 상품명']);
const imageIndex = firstIndex(index, ['상품 이미지 url', '이미지 url']);
const products = [];
const seen = new Set();
const imageDir = path.join(repo, 'images', 'products');
await fs.mkdir(imageDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  for (const row of rows.slice(1)) {
    const id = Number(row[0]);
    const link = (row[linkIndex] || '').trim().replace(/\/+$/, '');
    if (!id || !link || seen.has(link)) continue;
    seen.add(link);
    let title = (row[titleIndex] || '').trim();
    let imageUrl = (row[imageIndex] || '').trim();
    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(500);
      title = (await page.title()).replace(/\s*\|\s*쿠팡\s*$/, '').trim() || title;
      imageUrl = await page.locator('meta[property="og:image"]').getAttribute('content') || imageUrl;
    } catch (error) {
      console.warn(`상품 ${id} 자동 조회 실패: ${error.message}`);
    }
    const localImage = `./images/products/product-${String(id).padStart(3, '0')}.jpg`;
    if (imageUrl) {
      try {
        const imageResponse = await fetch(imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl);
        if (imageResponse.ok) {
          await fs.writeFile(path.join(imageDir, `product-${String(id).padStart(3, '0')}.jpg`), Buffer.from(await imageResponse.arrayBuffer()));
          imageUrl = localImage;
        }
      } catch (error) {
        console.warn(`상품 ${id} 이미지 저장 실패: ${error.message}`);
      }
    }
    products.push({
      id,
      category: (row[categoryIndex] || '').replace(/^#/, '').trim(),
      product: {
        title,
        coupangUrl: link,
        imageUrl: imageUrl.startsWith('./') ? imageUrl : localImage
      }
    });
  }
} finally {
  await browser.close();
}

await fs.writeFile(path.join(repo, 'data', 'products.json'), `${JSON.stringify(products, null, 2)}\n`);
console.log(`상품 ${products.length}개를 동기화했습니다.`);

function firstIndex(indexer, names) {
  for (const name of names) {
    const value = indexer(name.toLowerCase());
    if (value >= 0) return value;
  }
  return -1;
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(value);
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else value += char;
  }
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}
