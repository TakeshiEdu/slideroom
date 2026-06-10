# Vercel + Supabase 開発環境メモ

## 目的

ローカルLANサーバーの `/api/state` と `/api/blob/*` を、Vercel Functions + Supabase に置き換える。

- Vercel: ViteフロントとAPI Functionsを配信
- Supabase Database: 共有ルーム状態を `app_state` に保存
- Supabase Storage: PPTXファイル本体を `slideroom-uploads` bucket に保存
- TTL: ルーム作成から24時間を超えたデータは `/api/state` アクセス時に削除

## GitHub / Vercel

対象リポジトリ:

```text
TakeshiEdu/slideroom
```

VercelのProject Settingsで以下を設定する。

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
```

## Supabase

1. Supabase Projectを作る
2. SQL Editorで `supabase/schema.sql` を実行する
3. Storageに `slideroom-uploads` bucket が作られていることを確認する
4. Vercelに環境変数を設定する

## 環境変数

Vercelには `.env.example` と同じキーを設定する。

ブラウザに公開される:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_STORAGE_BUCKET
```

Vercel Functionsだけで使う:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_STORAGE_BUCKET
SLIDEROOM_STATE_ID
SLIDEROOM_ROOM_TTL_HOURS
SLIDEROOM_MAX_UPLOAD_BYTES
```

`SUPABASE_SERVICE_ROLE_KEY` はブラウザ側に出さない。

## API

既存フロントは基本的に同じAPIを使う。

```text
GET    /api/info
GET    /api/state
PUT    /api/state
GET    /api/blob/:key
POST   /api/blob/:key
DELETE /api/blob/:key
POST   /api/blob/:key/upload-url
GET    /api/blob/:key/download-url
```

Vercel上ではPPTX本体をFunctions経由で送るとサイズ制限に当たりやすい。ブラウザはまず署名付きURLを取得し、Supabase Storageへ直接アップロードする。ローカルLANサーバーでは従来通り `/api/blob/:key` にfallbackする。

