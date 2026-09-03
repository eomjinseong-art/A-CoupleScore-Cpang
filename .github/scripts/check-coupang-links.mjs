import { appendFile } from 'node:fs/promises';

const sheetUrl = 'https://docs.google.com/spreadsheets/d/1l7niiK9RbZwo_x0PI6T2vCqjIKn9c_gvxVrrKjwyo20/gviz/tq?tqx=out:csv&sheet=%EA%B4%91%EA%B3%A0%EC%9A%A9';
const csv = await (await fetch(sheetUrl)).text();
const rows = parseCsv(csv);
const headers = rows[0].map(header => header.trim().toLowerCase());
const linkIndex = headers.indexOf('쿠팡 파트너스 링크');
const titleIndex = headers.indexOf('상품명') >= 0 ? headers.indexOf('상품명') : headers.indexOf('실제 상품명');
const links = new Map();

for (const row of rows.slice(1)) {
  const link = (row[linkIndex] || '').trim().replace(/\/+$/, '');
  if (link && !links.has(link)) links.set(link, row[titleIndex] || '(상품명 없음)');
}

const failures = [];
for (const [link, title] of links) {
  try {
    const response = await fetch(link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CoupangLinkMonitor/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });
    if (response.status >= 400) {
      failures.push(`${response.status} | ${title} | ${link}`);
    }
  } catch (error) {
    failures.push(`NETWORK | ${title} | ${link} | ${error.message}`);
  }
}

if (failures.length) {
  const report = `문제 링크 ${failures.length}개 / 중복 제거 후 검사 ${links.size}개\n${failures.join('\n')}`;
  process.stdout.write(report);
  await writeOutput('report', report);
  process.exitCode = 1;
} else {
  console.log(`OK: 중복 제거 후 ${links.size}개 링크가 정상 응답했습니다.`);
}

async function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${name}<<EOF\n${value}\nEOF\n`);
  }
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && input[i + 1] === '"' && quoted) {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(value);
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some(cell => cell.trim())) rows.push(row);
  return rows;
}
