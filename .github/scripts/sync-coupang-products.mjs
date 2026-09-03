import fs from 'node:fs/promises';
import path from 'node:path';

const repo = process.cwd();
const sheetUrl = 'https://docs.google.com/spreadsheets/d/1l7niiK9RbZwo_x0PI6T2vCqjIKn9c_gvxVrrKjwyo20/gviz/tq?tqx=out:csv&sheet=%EA%B4%91%EA%B3%A0%EC%9A%A9';
const imageDir = path.join(repo, 'images', 'products');
const productsPath = path.join(repo, 'data', 'products.json');
const sheetExportPath = path.join(repo, 'data', 'sheet-update.csv');
const failedPath = path.join(repo, 'data', 'scrape-failed.json');
const maxProducts = Number(process.env.MAX_PRODUCTS || 0);
const delayMs = Number(process.env.DELAY_MS || 1200);
const catalogOnly = process.argv.includes('--catalog-only');

const TEMPLATE_TITLES = new Set([
  '화해 유도 감성 추천 아이템',
  '갈등 완화 커플 솔루션 템',
  '집데이트 분위기 반전 아이템',
  '너와 나의 속마음 커플북',
  '특별한 날 로맨틱 커플 선물',
  '마음을 부드럽게 전하는 소통 템'
]);

await fs.mkdir(imageDir, { recursive: true });

const existing = await loadExistingProducts();
const failed = await loadFailedIds();

if (catalogOnly) {
  const current = [...existing.values()].sort((a, b) => a.id - b.id);
  await saveProducts(current);
  console.log(`카탈로그만 정리했습니다. 상품 ${current.length}개.`);
  process.exit(0);
}

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
let scrapedCount = 0;

for (const row of rows.slice(1)) {
  const id = Number(row[0]);
  const link = (row[linkIndex] || '').trim().replace(/\/+$/, '');
  if (!id || !link || seen.has(link)) continue;
  seen.add(link);

  const previous = existing.get(id);
  const linkChanged = !previous || previous.product.coupangUrl !== link;
  let title = chooseTitle(row[titleIndex], previous, linkChanged, id);
  const category = (row[categoryIndex] || '').replace(/^#/, '').trim() || previous?.category || '';
  let remoteImageUrl = (row[imageIndex] || '').trim();
  if (isUnsplash(remoteImageUrl)) remoteImageUrl = '';

  const jpgPath = path.join(imageDir, `product-${String(id).padStart(3, '0')}.jpg`);
  const hasJpg = await fileExists(jpgPath);
  const needsTitle = linkChanged || !title || isWeakTitle(title, id);
  const needsImage = !hasJpg || linkChanged;
  let productId = linkChanged ? '' : previous?.product?.productId || '';

  let didScrape = false;
  if (needsImage || needsTitle) {
    if (maxProducts && scrapedCount >= maxProducts) break;
    scrapedCount += 1;
    didScrape = true;
    const scraped = await scrapeProduct(id, link, productId);
    if (scraped.title && !isBlockedTitle(scraped.title) && !isWeakTitle(scraped.title, id)) {
      title = scraped.title;
    }
    if (needsImage && scraped.imageUrl) remoteImageUrl = scraped.imageUrl;
    else if (needsImage) failed.add(id);
    if (scraped.productId) productId = scraped.productId;
  }

  if (!title || isBlockedTitle(title) || isWeakTitle(title, id)) {
    title = previous?.product?.title && !isWeakTitle(previous.product.title, id)
      ? previous.product.title
      : `커플 추천 아이템 ${id}`;
  }

  let imageUrl = hasJpg
    ? `./images/products/product-${String(id).padStart(3, '0')}.jpg`
    : previous?.product?.imageUrl?.startsWith('./')
      ? previous.product.imageUrl
      : `./images/products/product-${String(id).padStart(3, '0')}.jpg`;

  if (needsImage && remoteImageUrl && remoteImageUrl.startsWith('http') && !isUnsplash(remoteImageUrl)) {
    const saved = await downloadImage(remoteImageUrl, jpgPath, id);
    if (saved) imageUrl = `./images/products/product-${String(id).padStart(3, '0')}.jpg`;
    else failed.add(id);
  }

  products.push({
    id,
    category,
    product: {
      title,
      coupangUrl: link,
      imageUrl
    }
  });

  if (didScrape || products.length % 15 === 0) await saveProducts(mergeWithExisting(products));
  const status = (await fileExists(jpgPath)) ? '사진' : '사진없음';
  console.log(`[${products.length}] ${id} ${status} ${title}`);
  if (didScrape) await sleep(delayMs);
}

await saveProducts(products);
await fs.writeFile(failedPath, `${JSON.stringify([...failed].sort((a, b) => a - b), null, 2)}\n`);
const jpgCount = (await Promise.all(products.map(async item => {
  const file = path.join(imageDir, `product-${String(item.id).padStart(3, '0')}.jpg`);
  return fileExists(file);
}))).filter(Boolean).length;
console.log(`상품 ${products.length}개 동기화 완료. 실제 사진 ${jpgCount}개.`);
console.log(`시트 붙여넣기 파일: ${path.relative(repo, sheetExportPath)}`);

function chooseTitle(sheetTitle, previous, linkChanged, id) {
  const fromSheet = String(sheetTitle || '').trim();
  if (fromSheet && !isWeakTitle(fromSheet, id)) return fromSheet;
  if (!linkChanged && previous?.product?.title && !isWeakTitle(previous.product.title, id)) {
    return previous.product.title;
  }
  return fromSheet;
}

function mergeWithExisting(list) {
  const merged = new Map(existing);
  for (const item of list) merged.set(item.id, item);
  return [...merged.values()].sort((a, b) => a.id - b.id);
}

async function saveProducts(list) {
  const ordered = [...list].sort((a, b) => a.id - b.id);
  const siteProducts = ordered.map(({ id, category, product }) => ({
    id,
    category,
    product: {
      title: product.title,
      coupangUrl: product.coupangUrl,
      imageUrl: product.imageUrl
    }
  }));
  await writeFileRetry(productsPath, `${JSON.stringify(siteProducts, null, 2)}\n`);
  const csvLines = [
    ['NO', '쿠팡 파트너스 링크', '상황 태그', '상품명', '상품 이미지 URL', '이미지 상태']
      .map(csvCell).join(','),
    ...ordered.map(item => [
      item.id,
      item.product.coupangUrl,
      item.category,
      item.product.title,
      '',
      item.product.imageUrl?.endsWith('.jpg') ? 'GitHub 저장 완료' : '사진 수집 실패'
    ].map(csvCell).join(','))
  ];
  await fs.writeFile(sheetExportPath, `\ufeff${csvLines.join('\n')}\n`);
}

async function scrapeProduct(id, link, knownProductId = '') {
  try {
    const productId = knownProductId || await resolveProductId(link);
    if (!productId) {
      console.warn(`상품 ${id}: 쿠팡 상품번호를 찾지 못했습니다.`);
      return { title: '', imageUrl: '', productId: '' };
    }
    const html = await fetchText(`https://search.naver.com/search.naver?query=${encodeURIComponent(`${productId} 쿠팡`)}`);
    const parsed = parseNaverResult(html, productId);
    console.log(`상품 ${id} productId=${productId} 제목=${parsed.title || '-'} 이미지=${parsed.imageUrl ? '있음' : '없음'}`);
    return { ...parsed, productId };
  } catch (error) {
    console.warn(`상품 ${id} 수집 실패: ${error.message}`);
    return { title: '', imageUrl: '', productId: knownProductId || '' };
  }
}

async function resolveProductId(link) {
  let url = link;
  for (let i = 0; i < 8; i++) {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: requestHeaders(),
      signal: AbortSignal.timeout(15000)
    });
    const location = response.headers.get('location');
    if (!location) break;
    url = new URL(location, url).href;
    const productId = url.match(/\/vp\/products\/(\d+)/)?.[1] || url.match(/[?&]ctag=(\d+)/)?.[1];
    if (productId) return productId;
  }
  return '';
}

function parseNaverResult(html, productId) {
  const decoded = html
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');

  let imageUrl = '';
  for (const match of decoded.matchAll(/[?&]src=(https?[^"'&]+)/g)) {
    const src = decodeURIComponent(match[1]);
    if (/coupangcdn\.com/i.test(src)) {
      imageUrl = src.split('&')[0];
      break;
    }
  }
  if (!imageUrl) {
    const encoded = decoded.match(/https%3A%2F%2Fthumbnail\.coupangcdn\.com[^"'&]+/i);
    if (encoded) imageUrl = decodeURIComponent(encoded[0]).split('&')[0];
  }
  if (!imageUrl) {
    const direct = decoded.match(/https:\/\/thumbnail\.coupangcdn\.com\/[^"'\s<>]+/i);
    if (direct) imageUrl = decodeURIComponent(direct[0]).split('&')[0];
  }

  const skip = /네이버|검색|새 창|쿠팡!|로그인|열림|더보기|블로그|카페|뉴스|Access Denied|http|도착 보장|광고|판매자|리뷰|찜하기|장바구니|메뉴 영역|본문 영역|웨일|Keep에|실시간 데이터|순위 보드|데이터가 없습니다|최저가 알림|브라우저를 업데이트|개인정보|법적고지|가격비교|쿠프라이스/i;
  const scored = [];
  const chunks = decoded.includes(`products/${productId}`)
    ? decoded.split(`products/${productId}`).slice(1, 8)
    : [decoded];
  for (const chunk of chunks) {
    const candidates = [...chunk.matchAll(/>([^<]{8,140})</g)]
      .map(match => match[1].replace(/\s+/g, ' ').trim())
      .map(text => text.replace(/할인\d[\s\S]*$/, '').replace(/내일\([^)]*\)[\s\S]*$/, '').trim());
    for (const text of candidates) {
      if (text.length < 8 || text.length > 90 || !/[가-힣]{2,}/.test(text) || skip.test(text)) continue;
      let score = 0;
      if (/커플|문답|팔찌|티셔츠|꽃다발|기념일|데이트|선물|노트|레인부츠|장화/.test(text)) score += 6;
      if (/,\s*\d+\s*개/.test(text)) score += 4;
      if (text.length >= 16) score += 2;
      if (/가격비교|최저가 \d/.test(text)) score -= 4;
      if (score > 0) scored.push({ text, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  return { title: scored[0]?.text || '', imageUrl };
}

async function downloadImage(imageUrl, jpgPath, id) {
  try {
    const absoluteImageUrl = imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;
    const response = await fetch(absoluteImageUrl, {
      headers: { ...requestHeaders(), Referer: 'https://www.coupang.com/' },
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) return false;
    const imageBody = Buffer.from(await response.arrayBuffer());
    if (!imageBody || imageBody.length < 2000) return false;
    await fs.writeFile(jpgPath, imageBody);
    return true;
  } catch (error) {
    console.warn(`상품 ${id} 이미지 저장 실패: ${error.message}`);
    return false;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: requestHeaders(),
    signal: AbortSignal.timeout(15000)
  });
  return response.text();
}

function requestHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
  };
}

async function loadExistingProducts() {
  try {
    const parsed = JSON.parse(await fs.readFile(productsPath, 'utf8'));
    return new Map(parsed.map(item => [item.id, item]));
  } catch {
    return new Map();
  }
}

async function loadFailedIds() {
  try {
    const parsed = JSON.parse(await fs.readFile(failedPath, 'utf8'));
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function isBlockedTitle(value) {
  return /access denied|error|쿠팡이 추천하는|접근이 거부|blocked/i.test(value || '');
}

function isJunkTitle(value) {
  return /지식iN|오일필터|현대모비스|그랜드스타렉스|르노코리아|글래스런|모래요 여러분|궁금한 것은|순정부품|P96985730/i.test(value || '');
}

function isWeakTitle(value, id) {
  const title = String(value || '').trim();
  if (!title) return true;
  if (title === `커플 추천 아이템 ${id}`) return true;
  if (TEMPLATE_TITLES.has(title)) return true;
  if (/unsplash/i.test(title)) return true;
  if (isJunkTitle(title)) return true;
  return /^(쇼핑|쿠팡|상품)$/.test(title)
    || /Access Denied|^Keep에/.test(title);
}

function isUnsplash(url) {
  return /unsplash\.com/i.test(url || '');
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeFileRetry(filePath, contents, attempts = 8) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.writeFile(filePath, contents);
      return;
    } catch (error) {
      lastError = error;
      await sleep(500 * (i + 1));
    }
  }
  throw lastError;
}

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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
