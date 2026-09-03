# 그날의 남녀 - 시스템 아키텍처

## 1. 전체 구조

```text
Google Sheets (광고용 탭)
        |
        | 공개 CSV 읽기
        v
[로컬 PC] npm run sync
  ├─ 단축링크 → 쿠팡 상품번호
  ├─ 네이버 검색으로 상품명·사진 URL 수집
  ├─ jpg를 images/products 에 저장
  └─ data/products.json 갱신
        |
        | git push
        v
GitHub 저장소  ── Vercel 정적 배포
        |
        v
사용자 브라우저 ── 상품 클릭 ──> 쿠팡 새 탭

GitHub Actions
  └─ 매일 파트너스 링크 HTTP 상태만 점검 (수집은 하지 않음)
```

## 2. 구성 요소

- **프런트엔드**: `index.html`이 상품 카드, 태그, 광고 배너, 하단 메뉴를 렌더링한다.
- **상품 원본**: Google Sheets의 `광고용` 탭에서 링크·태그를 관리한다.
- **배포용 데이터**: `data/products.json`은 사이트가 즉시 사용할 수 있는 상품 목록이다.
- **이미지 캐시**: `images/products/*.jpg`에 상품별 대표 이미지를 저장한다. 사이트는 이 로컬 사진을 쓴다.
- **수집**: 로컬 PC의 `npm run sync`. GitHub Actions IP는 쿠팡/네이버에서 막히므로 수집을 Actions에서 돌리지 않는다.
- **링크 모니터링**: `.github/workflows/check-coupang-links.yml`이 매일 링크를 검사하고 실패 시 GitHub Issue를 만든다.

## 3. 데이터 흐름

1. 관리자가 Google Sheets `광고용` 탭에 쿠팡파트너스 링크를 입력한다.
2. 로컬에서 `npm run sync`가 공개 CSV를 읽고, 이미 사진·실제목이 있는 행은 건너뛴다.
3. 비어 있는 행만 네이버 검색으로 상품명과 쿠팡 CDN 썸네일을 찾는다.
4. jpg와 `products.json`을 GitHub에 올린다.
5. Vercel이 GitHub 변경을 감지해 사이트를 재배포한다.
6. 사용자는 상품 카드를 클릭하고 쿠팡을 새 탭에서 확인한다.

## 4. 운영 기준

- 새 상품은 **`광고용` 탭에 링크를 추가**한 뒤 로컬에서 `npm run sync`를 실행한다.
- 같은 파트너스 링크가 두 행에 있으면 뒤 행은 사이트에 넣지 않는다.
- 이미 jpg가 있고 링크가 안 바뀌었으면 다시 긁지 않는다. 지금 사이트 사진이 유지되는 이유다.
- 시트에 Unsplash 주소가 남아 있어도 사이트는 로컬 jpg를 우선한다.
- 링크 오류는 GitHub Actions `check-coupang-links`와 `link-check` 이슈로 알린다.

## 5. 책임 경계

| 영역 | 관리 위치 | 담당 |
| --- | --- | --- |
| 상품 링크·태그 | Google Sheets `광고용` | 관리자 |
| 상품명·이미지 수집 | 로컬 `npm run sync` | 관리자 PC |
| 사이트 화면·배너 | `index.html`·`data/config.json` | 개발 |
| 배포 | Vercel | GitHub 연동 자동 배포 |
| 링크 생존 점검 | GitHub Actions | 매일 자동화 |
