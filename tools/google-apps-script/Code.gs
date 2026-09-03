const SHEET_NAME = '광고용';
const OUTPUT_SHEET_NAME = '사이트용상품';
const REQUIRED_HEADERS = ['NO', '쿠팡파트너스 링크', '상황 태그', '상품명', '상품 이미지 URL', '이미지 상태'];
const FAILED_PRODUCT_LINKS = new Set([
  'https://link.coupang.com/a/gJDL6qQAM0',
  'https://link.coupang.com/a/gJDMFt0S4q',
  'https://link.coupang.com/a/gJDNjcQKgm',
  'https://link.coupang.com/a/gJDRZV4j9g'
]);

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('사이트 상품 관리')
    .addItem('상품 데이터 정리', 'syncProducts')
    .addItem('매일 자동 실행 설정', 'installDailyTrigger')
    .addToUi();
}

function syncProducts() {
  const source = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
  if (!source) throw new Error(`'${SHEET_NAME}' 탭을 찾을 수 없습니다.`);

  const values = source.getDataRange().getDisplayValues();
  if (values.length < 2) throw new Error('광고용 탭에 상품 데이터가 없습니다.');

  const headers = values[0].map(value => value.trim());
  const index = name => headers.findIndex(header => header === name);
  const linkIndex = firstIndex(index, ['쿠팡 파트너스 링크', '쿠팡파트너스 링크', '상품 링크']);
  const titleIndex = firstIndex(index, ['상품명', '실제 상품명']);
  const categoryIndex = firstIndex(index, ['상황 태그', '카테고리']);
  const imageIndex = firstIndex(index, ['상품 이미지 URL', '이미지 URL']);
  if ([linkIndex, titleIndex, categoryIndex, imageIndex].some(value => value < 0)) {
    throw new Error('필수 열이 없습니다: 쿠팡파트너스 링크, 상품명, 상황 태그, 상품 이미지 URL');
  }

  const output = [REQUIRED_HEADERS];
  const seen = new Set();
  values.slice(1).forEach(row => {
    const link = normalizeLink(row[linkIndex]);
    const title = row[titleIndex].trim();
    if (!link || !title || seen.has(link)) return;
    seen.add(link);

    const imageUrl = (row[imageIndex] || '').trim();
    const imageStatus = FAILED_PRODUCT_LINKS.has(link)
      ? '상품 추출 실패 - 링크 교체 필요'
      : imageUrl ? checkImage(imageUrl) : '재검사 대기';
    output.push([
      row[0].trim(),
      link,
      (row[categoryIndex] || '').replace(/^#/, '').trim(),
      title,
      imageUrl,
      imageStatus
    ]);
  });

  let target = SpreadsheetApp.getActive().getSheetByName(OUTPUT_SHEET_NAME);
  if (!target) target = SpreadsheetApp.getActive().insertSheet(OUTPUT_SHEET_NAME);
  target.clearContents();
  target.getRange(1, 1, output.length, REQUIRED_HEADERS.length).setValues(output);
  target.setFrozenRows(1);
  target.autoResizeColumns(1, REQUIRED_HEADERS.length);
  const statusColors = output.slice(1).map(row => {
    const color = row[5] === '정상' ? '#DCFCE7' : row[5] === '재검사 대기' ? '#FEF3C7' : row[5] === '이미지 URL 없음' ? '#FEF3C7' : '#FEE2E2';
    return Array(REQUIRED_HEADERS.length).fill(color);
  });
  if (statusColors.length) {
    target.getRange(2, 1, statusColors.length, REQUIRED_HEADERS.length).setBackgrounds(statusColors);
  }
  SpreadsheetApp.getActive().toast(`${output.length - 1}개 상품을 정리했습니다.`, '사이트 상품 관리');
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncProducts')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncProducts').timeBased().everyDays(1).atHour(3).create();
  SpreadsheetApp.getActive().toast('매일 오전 3시 자동 정리를 설정했습니다.', '사이트 상품 관리');
}

function firstIndex(index, names) {
  for (const name of names) {
    const value = index(name);
    if (value >= 0) return value;
  }
  return -1;
}

function normalizeLink(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function checkImage(url) {
  if (!url) return '이미지 URL 없음';
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    const code = response.getResponseCode();
    return code >= 200 && code < 400 ? '정상' : `접속 오류(${code})`;
  } catch (error) {
    return '접속 실패';
  }
}
