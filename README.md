# SlideRoom

SlideRoomは、大学・ゼミ・グループワーク向けのPowerPoint提出・管理・結合MVPアプリです。  
ルーム作成、招待コード参加、提出ファイル管理、スライド順番調整、PPTX出力、設定保存までをブラウザ上で操作できます。

## 使用技術

- React
- TypeScript
- Vite
- Zustand
- IndexedDB (`idb`)
- `@dnd-kit` for drag and drop
- `jszip` for PPTX analysis and browser-side OOXML merge
- `jspdf` for browser-side PDF export
- `pptxgenjs` for fallback PPTX export
- `sonner` for toast notifications
- `lucide-react` for icons

## 起動方法

```bash
npm install
npm run dev
```

開発サーバー起動後、表示されたローカルURLをブラウザで開いてください。

## 実装済み機能

- ホーム、ルーム一覧、ルーム詳細、提出ファイル、結合、設定のレスポンシブUI
- ルーム作成、招待コードによる参加
- ルーム検索、ステータスフィルタ、並び替え
- メンバー追加・削除、提出状況の自動計算
- ファイルアップロード、差し替え、削除、ステータス変更
- PPTXアップロード時の実スライド枚数解析と、解析失敗時の仮スライド生成
- ドラッグ&ドロップによるスライド順番変更
- スライド順番、ルーム、設定、提出ファイルメタデータの永続化
- IndexedDBへのアップロードBlob保存
- 結合プレビュー、出力設定、出力履歴
- ファイル名テンプレートによる出力ファイル名の自動生成
- アップロード済みPPTXのみで構成された結合対象に対する、ブラウザ内の実PPTX結合出力
- 非PPTX・未保存Blob・結合失敗時の `pptxgenjs` による簡易PPTX fallback
- アップロード済みPPTXのみで構成された結合対象に対する、ブラウザ内の実PPTX由来PDF出力
- トースト通知、空状態、削除確認

## MVPの制限

- 実PPTX結合はブラウザ内OOXMLコピー方式の基本実装です。複雑なアニメーション、特殊グラフ、マクロ、壊れたリレーションを含むPPTXは崩れる可能性があります。
- 結合対象がアップロード済みPPTXだけではない場合、または実結合に失敗した場合は、確認用の簡易PPTXにfallbackします。
- PDF出力はPPTXプレビューSVGを画像化してPDFへ配置する基本実装です。PDF内テキスト検索・選択はできず、対象外ファイルを含む場合は出力エラーになります。
- 表紙スライド追加、ページ番号、担当者名追記などの出力装飾は現状fallback PPTX側の機能です。
- 認証、メール通知、リアルタイム同期、外部ストレージ連携はMVP範囲外です。

## 開発時の注意

- UIの見た目は `src/styles/global.css` に集約しています。
- アプリ状態は `src/stores/useAppStore.ts` に集約し、画面から直接ストレージを触らない構成です。
- ファイルBlob保存は `src/services/storageService.ts` 経由で行います。
- PPTX/PDF出力処理は `src/services/mergeService.ts` に分離しています。
- デモデータに戻したい場合は、設定画面の「デモデータ初期化」を使用してください。
