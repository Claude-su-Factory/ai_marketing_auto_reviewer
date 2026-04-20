# Meta DCO API 검증 노트 (2026-04-20)

Plan A (Platform Adapter + Meta DCO 마이그레이션) Task 1의 preflight 연구 결과를 기록한다.
이 노트는 Task 4 (`assembleAssetFeedSpec`)와 Task 5 (`parseBodyAssetBreakdown`) 구현의 근거 자료이다.

---

## asset_feed_spec 필드 shape (확인 결과)

Meta Marketing API 공식 문서 (Ad Account / AdCreatives reference, Asset Feed Spec 페이지)에서 확인한 top-level 필드:

- `titles` — `{ text, url_tags, adlabels?, asset_source?, automation_status?, uuid?, language?, ... }[]`
- `bodies` — titles와 동일한 객체 구조. `text` 필수, 나머지 선택
- `descriptions` — bodies/titles와 동일 구조
- `link_urls` — `{ website_url, display_url?, deeplink_url?, carousel_see_more_url?, url_tags?, adlabels?, omnichannel_link_spec? }[]`
- `images` — `{ hash, url_tags?, image_crops?, adlabels? }[]`
- `videos` — `{ video_id, thumbnail_url?, thumbnail_hash?, caption_ids?, url_tags?, adlabels? }[]`
- `call_to_action_types` — enum 문자열 배열 (`SHOP_NOW`, `LEARN_MORE`, ...)
- `ad_formats` — `AUTOMATIC_FORMAT` | `CAROUSEL` | `SINGLE_IMAGE` | `SINGLE_VIDEO` | `POST` 의 배열
- `call_to_actions` — CTA 객체 배열 (고급 용도)
- `optimization_type` — 최적화 힌트

Plan A의 minimal DCO Ad 조립에 필요한 서브셋은 `titles` (1개 공통) + `bodies` (2~3개) + `images` (1개) + `videos` (1개) + `link_urls` (1개) + `call_to_action_types` + `ad_formats`.

## adlabels 라운드트립 여부

**결론: 라운드트립 불가. `/insights?breakdowns=['body_asset']` 응답의 `body_asset`은 `adlabels`를 포함하지 않는다.**

근거:

1. AdCreatives reference (`https://developers.facebook.com/docs/marketing-api/reference/ad-account/adcreatives/`)는 `asset_feed_spec.bodies[]`가 `adlabels` (list of `{name}`)를 받는다고 명시. 따라서 submit 시에는 `adlabels: [{ name: "variant-<uuid>" }]`를 붙이는 것이 가능하다.

2. 그러나 Asset Feed Spec Insights 페이지 (`https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/insights/`)의 응답 예시는 다음과 같다:
   ```json
   {
     "body_asset": { "text": "Test text", "id": "6051732675652" },
     "image_asset": { "hash": "<REDACTED>", "url": "<REDACTED>", "id": "..." },
     "impressions": "...",
     ...
   }
   ```
   `body_asset` 객체는 `id`와 `text`만 반환하며, `adlabels`는 echo되지 않는다. `title_asset`, `description_asset` 등 다른 asset breakdown 필드도 동일 패턴으로 `{id, text}` 또는 `{id, hash, url}` 형식이다.

3. Asset Feed Spec Options 페이지 (`.../asset-feed-spec/options/`)에도 bodies/titles/descriptions 객체에 대한 `adlabels` 언급이 없다. `adlabels`는 `carousels.child_attachments` 맥락에서만 문서화되어 있다.

4. Meta Insights는 `filtering` 파라미터로 `ad.adlabels` (ad-level) 레벨 필터링은 지원하지만, asset 레벨 adlabels echo에 대한 공개 레퍼런스는 존재하지 않는다.

즉 submit은 되지만, 응답에서 다시 받아올 공식 보증이 없기 때문에 variant 역매핑 키로 사용할 수 없다.

## 선택된 매핑 전략

**Strategy B (text 매칭)** 을 선택한다.

절차:

1. Launch 시 `asset_feed_spec.bodies[i].text = Creative.copy.body + '\n\n' + hashtags` 로 submit. `adlabels`는 생략 (또는 향후 Meta가 echo하기 시작하면 사용하도록 선택적으로 붙여둔다. 동작에 영향 없음).
2. Creative 레코드에 기존의 `metaAssetLabel` 대신 또는 추가로 **제출된 body text의 정규화된 해시** (`sha1(body + '\n\n' + hashtags)` 또는 trimmed exact string)를 저장. 본 noote 기준 해시 방식을 권장.
3. Monitor 시 `/insights?breakdowns=['body_asset']` 응답에서 각 row의 `body_asset.text`를 동일 방식으로 정규화 후 저장된 값과 매칭해 `variantLabel`을 복원.
4. 매칭되지 않는 row (Meta auto-gen 또는 우리 submit 아님) 은 skip.

선택 이유:

- Strategy A (adlabels 라운드트립)는 공식 문서상 echo 보증이 없어 프로덕션 의존 불가
- text 매칭은 Meta 응답에 항상 포함되는 `body_asset.text`를 사용하므로 API 변경에 견고
- variant 3개의 body는 서로 다른 angle(emotional/numerical/urgency)로 생성되므로 충돌 가능성 낮음. 동일 text가 드물게 겹치더라도 같은 variantGroup 내에서는 의미상 동일 variant로 취급 가능
- body_asset.id도 insights에 함께 반환되므로 `(id, text)` 쌍을 보조 매칭 키로 사용 가능

트레이드오프:

- Creative 테이블 스키마를 spec 초안의 `metaAssetLabel: string` 에서 `metaBodyTextHash: string` (또는 `metaSubmittedBodyText: string`) 로 변경 필요. 이 변경은 winner-db spec §2와 Task 3/4/5 설계에 반영해야 한다.
- body 앞뒤 공백, CRLF vs LF, Meta가 렌더링 과정에서 문자열을 수정할 가능성 등 정규화 규칙이 견고해야 한다. Task 5 단위 테스트에서 문자열 변형 케이스를 커버한다.

## SDK 버전 호환성

`facebook-nodejs-business-sdk` v20.0.3 (package.json 기준 `^20.0.2`, 실제 설치 v20.0.3).

- `node_modules/facebook-nodejs-business-sdk/src/objects/ad-creative.js:29` 에 `asset_feed_spec: 'asset_feed_spec'` 이 AdCreative Fields enum에 등록되어 있어 SDK가 해당 필드를 정식으로 인식한다.
- `node_modules/facebook-nodejs-business-sdk/src/objects/ad-account.js:407` 의 `createAdCreative(fields, params)` 는 `params` 객체를 그대로 `/act_{id}/adcreatives` POST 바디로 전달하므로 `params.asset_feed_spec = {...}` 전달이 가능하다. 전용 helper는 없지만 DCO 생성에 기능적 제약은 없다.
- Insights 호출은 기존 `Ad.getInsights(fields, { breakdowns: ['body_asset'], ... })` 로 동일하게 사용 가능.

결론: SDK 20.0.3은 DCO 마이그레이션 요구 기능을 전부 지원한다. 추가 업그레이드나 raw HTTP fallback 불필요.

## 후속 영향 (스펙 반영 필요)

- `docs/superpowers/specs/2026-04-20-winner-db-variant-orchestration-design.md` §1.2, §2, §3.3, §3.5
  - Creative 타입의 `metaAssetLabel: string` 필드를 **`metaBodyTextHash: string`** (또는 `metaSubmittedBodyText: string`) 으로 교체
  - §1.2의 "각 body에 `adlabels: [{ name: "variant-<uuid>" }]` 부착" 문장을 Strategy B로 업데이트
  - §3.5 monitor 흐름에서 `body_asset.label로 variantLabel 복원` → `body_asset.text를 정규화하여 Creative.metaBodyTextHash와 매칭` 으로 수정
  - §4 알려진 이슈 테이블의 `Meta breakdown에 adlabels 없는 row` 행을 `body_asset.text가 기록된 해시와 매칭 안 되는 row` 로 수정

이 변경은 Plan A Task 2 (Creative 스키마)과 Task 4/5 구현에 반영한다.

## 확인한 URL 및 날짜

2026-04-20 확인:

- https://developers.facebook.com/docs/marketing-api/advantage-plus-creative  (404 at fetch time — 해당 경로는 문서 재구성으로 이동한 것으로 보임. 대체 페이지 사용)
- https://developers.facebook.com/docs/marketing-api/reference/ad-account/adcreatives/  — asset_feed_spec 필드 목록 및 bodies/titles 객체에 `adlabels` 허용 확인
- https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/  — top-level 필드 확인
- https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/options/  — body/title에 adlabels 언급 없음 확인 (adlabels는 carousels.child_attachments 맥락에만)
- https://developers.facebook.com/docs/marketing-api/ad-creative/asset-feed-spec/insights/  — body_asset 응답 shape `{id, text}` 확인 (adlabels echo 안 됨)
- https://developers.facebook.com/docs/marketing-api/insights/breakdowns/  — body_asset가 dynamic creative asset breakdown 필드로 등록되어 있음 확인

SDK 소스 확인:

- `/Users/yuhojin/Desktop/ad_ai/node_modules/facebook-nodejs-business-sdk/package.json` → v20.0.3
- `/Users/yuhojin/Desktop/ad_ai/node_modules/facebook-nodejs-business-sdk/src/objects/ad-creative.js:29` → `asset_feed_spec` Fields enum 등록
- `/Users/yuhojin/Desktop/ad_ai/node_modules/facebook-nodejs-business-sdk/src/objects/ad-account.js:407` → `createAdCreative(fields, params)` 시그니처
