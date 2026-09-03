# 그날의 남녀 - 시스템 아키텍처

## 1. 전체 구조

```text
Google Sheets (광고용 탭)
        |
        | 공개 CSV 읽기
        v
GitHub Actions
  ├─ 상품명·대표 이미지 수집
  ├─ 중복 링크 제거
  ├─ 링크 상태 점검
  └─ products.json 및 로컬 이미지 갱신
        |
        v
GitHub 저장소
  ├─ index.html
  ├─ data/products.json
  └─ images/products/*
        |
        v
Vercel 정적 배포
        |
        v
사용자 브라우저 ── 상품 클릭 ──> 쿠팡 새 탭
```

## 2. 구성 요소

- **프런트엔드**: `index.html`이 상품 카드, 태그, 광고 배너, 하단 메뉴를 렌더링한다.
- **상품 원본**: Google Sheets의 `광고용` 탭에서 링크·태그·상품명을 관리한다.
- **배포용 데이터**: `data/products.json`은 사이트가 즉시 사용할 수 있는 상품 목록이다.
- **이미지 캐시**: `images/products/`에 상품별 대표 이미지를 저장해 외부 이미지 장애 영향을 줄인다.
- **시트 관리 스크립트**: `tools/google-apps-script/Code.gs`가 중복 제거, 상태 색상 표시, 일일 정리를 담당한다.
- **자동 동기화**: `.github/workflows/sync-products.yml`이 매일 상품명과 이미지를 갱신하고 변경 내용을 커밋한다.
- **링크 모니터링**: `.github/workflows/check-coupang-links.yml`이 매일 링크를 검사하고 실패 시 GitHub Issue를 만든다.

## 3. 데이터 흐름

1. 관리자가 Google Sheets `광고용` 탭에 쿠팡파트너스 링크를 입력한다.
2. GitHub Actions가 공개 CSV를 읽고 같은 링크를 하나로 합친다.
3. Playwright로 쿠팡 페이지의 상품명과 `og:image`를 확인한다.
4. 이미지와 정규화된 상품 데이터를 GitHub에 저장한다.
5. Vercel이 GitHub 변경을 감지해 사이트를 재배포한다.
6. 사용자는 상품 카드를 클릭하고 쿠팡을 새 탭에서 확인한다.

## 4. 운영 기준

- 새 상품은 **`광고용` 탭에 링크를 추가**하는 것만으로 등록한다.
- 중복 링크는 자동으로 사이트 표시 대상에서 제외된다.
- 이미지·상품명 수집 실패는 기존 이미지 또는 대체 이미지로 사이트 노출을 유지한다.
- 링크 오류는 GitHub Actions 실패와 `link-check` 라벨 Issue로 관리자에게 알린다.
- Google Sheets 행 색상과 `사이트용상품` 탭 갱신은 Apps Script가 담당한다.
- 상품 동기화와 링크 점검은 각각 매일 실행되며, GitHub Actions에서 수동 실행할 수도 있다.

## 5. 책임 경계

| 영역 | 관리 위치 | 담당 |
| --- | --- | --- |
| 상품 링크·태그 | Google Sheets `광고용` | 관리자 |
| 상품명·이미지 수집 | GitHub Actions | 자동화 |
| 사이트 화면·배너 | `index.html`·`data/config.json` | 개발 |
| 배포 | Vercel | GitHub 연동 자동 배포 |
| 오류 확인 | GitHub Issues·Google Sheets 색상 | 관리자 |

