# ボット用API（/api/bot/*）

チャットのボットから余韻に記録するための、範囲を絞ったAPIです。

## 認証

- Workerのシークレット `BOT_API_TOKEN`（32文字以上のランダム文字列）を設定すると有効になります。未設定・短すぎる場合、`/api/bot/*` はすべて `503` を返します。
- リクエストに `Authorization: Bearer <BOT_API_TOKEN>` を付けます。比較は定数時間（`yoinSame`）です。鍵がない・違う場合は `401`。
- この鍵が使えるのは `/api/bot/` 以下だけです。`/api/records`、`/api/import`、`/api/tmdb/*`、`/api/enrich`、画面などには一切使えません（そちらは今までどおり合言葉ログインのクッキーが必要）。
- 逆に、合言葉ログインのクッキーだけでは `/api/bot/*` は使えません。
- POST/PATCH は `Content-Type: application/json` が必要です（Originチェックはありません）。
- 鍵を変えるときは `wrangler secret put BOT_API_TOKEN` で上書きすれば、古い鍵はすぐ無効になります。

## できること / できないこと

できる: 作品検索、棚の検索、記録の追加、評価・感想・鑑賞方法・ネタバレなどの部分更新、再鑑賞の追加、リストの閲覧・作成・編集、お知らせの取得・既読化。
できない: 削除（記録・リストとも）、一括読み込み（import）、TMDB接続設定、自動情報付与（enrich）、作品名・作品情報（movie）の書き換え。

## エンドポイント

### `GET /api/bot/search?query=...&limit=20`
TMDBで映画とドラマ・アニメ（TV）を日本語で検索し、人気順に混ぜて返します（最大40件）。
各結果に、棚にすでにあれば `onShelf`（`match` は `"tmdb"`＝TMDB IDで一致、`"title"`＝作品名で一致）。

```json
{"results":[{"tmdbId":129,"mediaType":"movie","title":"千と千尋の神隠し","originalTitle":"千と千尋の神隠し","releaseDate":"2001-07-20","year":"2001","overview":"（160文字まで）","poster":"https://image.tmdb.org/t/p/w500/...","onShelf":{"match":"tmdb","id":"...","title":"...","status":"watched","rating":4.5,"date":"2026-11-20","_revision":3}}]}
```

### `GET /api/bot/records?q=&status=&tmdbId=&mediaType=&limit=50`
棚の検索。`q` は作品名（記録名・TMDBの邦題・原題）の部分一致（大文字小文字区別なし）。`status` は `watched` / `want`。`limit` は最大200。更新が新しい順。
返り値: `{"total": 件数, "records": [記録（_revision付き）...]}`

### `GET /api/bot/records/:id`
1件取得。`{"record": {...,"_revision": n}}`

### `POST /api/bot/records`
```json
{"tmdbId":129,"mediaType":"movie","status":"watched","rating":4.5,"date":"2026-11-20","review":"感想","meta":"メモ"}
```
- `status` は必須（`watched` / `want`）。`rating` は 0〜5（小数第1位まで、0＝未評価、省略時0）。`date` は `YYYY-MM-DD` か空。
- `tmdbId` があればサーバー側でTMDBの作品情報と日本の配信先を取得し、画面から登録したときと同じ形の `movie` を付けます。`title` 省略時は日本語タイトル。`mediaType` 省略時は `movie`。
- 同じ `tmdbId`＋`mediaType` がすでに棚にあれば `409`（`record` に既存の記録）。
- `tmdbId` なしで作品名だけの場合、同じ作品名の記録があれば `409`。別作品として追加するなら `"allowDuplicateTitle": true`。
- 成功時 `201` `{"record": {...,"_revision":1}}`

### `PATCH /api/bot/records/:id`
```json
{"_revision":1,"rating":5,"review":"もう一度観たら最高だった"}
```
- 変更できるのは `status` / `rating` / `date` / `review` / `meta` / `spoiler` / `method` / `service` / `viewings` のみ。それ以外の項目を送ると `400`。
- `viewings` を送ると配列全体を置き換え、`date` / `method` / `service` は最新の鑑賞に合わせて自動で更新されます（再鑑賞を1件足すだけなら下の `POST .../viewings` が簡単です）。
- `_revision` 必須。最新でなければ `409`（`record` に最新の記録）。
- 成功時 `{"record": {...,"_revision":2}}`

### 追加項目（すべて省略可。既存の記録にはありません）
| 項目 | 内容 |
|---|---|
| `method` | 鑑賞方法: `theater`（劇場）/ `streaming`（配信）/ `tv`（TV）/ `disc`（DVD・BD）/ `other`（その他）/ `""` |
| `service` | 配信サービス名（`method` が `streaming` のとき。100文字まで） |
| `spoiler` | `true` なら感想はネタバレとして画面でタップするまで隠されます |
| `viewings` | 鑑賞の履歴（古い順）。各要素 `{"id","date":"YYYY-MM-DD"か"","method","service","rating":0〜5,"note"}`。ない記録は「鑑賞済みなら1回」と数えます |

`POST /api/bot/records` でも `method` / `service` / `spoiler` / `viewings` を指定できます。

### `POST /api/bot/records/:id/viewings`（再鑑賞を追加）
```json
{"_revision":3,"date":"2026-11-21","method":"streaming","service":"U-NEXT","rating":4.5,"note":"2回目"}
```
- `_revision` 必須（違えば `409`）。`date` / `method` / `service` / `rating`（0＝付けない）/ `note` は省略可。
- 初めての再鑑賞では、今までの鑑賞（記録の `date` / `method` / `rating`）を1回目として履歴に入れてから追加します。
- 記録の `date` / `method` / `service` は最新の鑑賞日の鑑賞に、`rating` は今回の評価（付けた場合のみ）に更新。`status` は `watched` になります。
- 成功時 `201` `{"record": {...}, "viewCount": 2}`

### リスト
- `GET /api/bot/lists` → `{"lists":[{"id","name","description","items":[{"recordId","title","note"}],"itemCount","created","updated","_revision"}]}`（更新が新しい順）
- `GET /api/bot/lists/:id` → `{"list": {..., "items":[{"recordId","title","note","rank":1,"record":{"id","title","status","rating","date","_revision","tmdbId","mediaType"}|null}]}}`
- `POST /api/bot/lists` `{"name":"生涯ベスト10","description":"","items":["記録ID", {"recordId":"記録ID","note":"一言"}]}` → `201`。`items` は棚にある記録のIDのみ（ないIDは `400`）。順番がそのまま順位です。
- `PATCH /api/bot/lists/:id` `{"_revision":1,"name"?,"description"?,"items"?}` → `items` は全体を置き換え（並べ替え・追加・削除はこれで）。`_revision` が違えば `409`。
- リストの削除はボットからはできません（画面からのみ）。

### お知らせ
「観たい」の作品（TMDB連携済み）を30分ごとに10件ずつ確認し（Cron Trigger）、次のときにお知らせを作ります。
- `stream`: 日本の見放題・無料・広告付き無料の配信サービスが前回の確認より増えた（初回は記録に保存されていた配信情報と比べます）
- `digital`: 配信が何もなかった作品がレンタル・購入で観られるようになった
- `release-soon`: 日本公開日（TVは放送開始日）が14日以内
- `release`: 日本公開日を迎えた（7日以内）

同じお知らせは二重に作りません。記録そのものは書き換えません。

- `GET /api/bot/notices?unread=1&limit=50` → `{"unread": 未読数, "progress":{"watching","checked","lastChecked"}, "notices":[{"id","kind","recordId","title","tmdbId","mediaType","poster","provider"?,"date"?,"message","created","read"}]}`（新しい順、`limit` 最大200）
- `POST /api/bot/notices/read` `{"ids":["..."]}` または `{"all":true}` → `{"marked": 件数}`

## エラー
`{"error": "日本語のメッセージ"}`。TMDB未接続・接続不可は `503`、TMDB側の失敗は `502`、混雑は `429`、TMDBに作品がない場合は `404`。

## テスト
```sh
node build.mjs && node --test test/*.test.mjs
```
（Node 22.5以上。D1の代わりに `node:sqlite`、TMDBはモック）
