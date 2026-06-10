# Codex依頼プロンプト

以下の仕様書とモック画像をもとに、SlideRoomというWebアプリを実装してください。

## 依頼内容

大学・ゼミ・グループワーク向けのPowerPoint提出・管理・結合Webアプリを作ります。  
生成済みUIモック画像の雰囲気をベースに、React + TypeScriptでレスポンシブ対応のフロントエンドを実装してください。

## 参照ファイル

- `SlideRoom_開発設計書.md`
- `mockups/01_home_selected_reference.jpeg`
- `mockups/02_room_list_tab.png`
- `mockups/03_room_detail_overview.png`
- `mockups/04_room_detail_files_tab.png`
- `mockups/05_global_files_tab.png`
- `mockups/06_room_slide_order_tab.png`
- `mockups/07_merge_tab.png`
- `mockups/08_settings_tab.png`

## 開発方針

1. まずUIを完成させてください。
2. 本物のPPTX結合はまだ実装しなくてよいです。
3. ファイル結合処理は `mergeService` に分離し、今はダミー実装にしてください。
4. モックデータで全画面が動くようにしてください。
5. PCとスマホの両方でモックに近い表示にしてください。
6. スマホでは下部ナビを表示してください。
7. PCでは上部ナビを表示してください。
8. ルーム詳細内には「概要 / メンバー / 提出ファイル / スライド順番 / 設定」のタブを作ってください。
9. スライド順番画面ではドラッグ&ドロップで並び替えできるようにしてください。
10. コンポーネント分割を丁寧に行い、保守しやすい構成にしてください。

## 推奨スタック

- React
- TypeScript
- Vite
- lucide-react
- @dnd-kit/core
- @dnd-kit/sortable
- CSS Modules または通常CSS

## 最初に作ってほしい画面

- ホーム
- ルーム一覧
- ルーム詳細 概要
- ルーム詳細 提出ファイル
- ルーム詳細 スライド順番
- アプリ全体 提出ファイル
- 結合
- 設定

## 完了条件

- `npm install` 後に `npm run dev` で起動できる
- 主要画面へ遷移できる
- モック画像に近い青白ベースの公共サービス風UIになっている
- PCとスマホで崩れない
- ドラッグ&ドロップ並び替えが動く
- 設定画面のトグルなど基本操作が動く
- 結合ボタンを押すとダミーファイルまたはトーストが出る
