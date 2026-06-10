# SlideRoom 開発設計書

## 0. この設計書の目的

この設計書は、生成済みUIモック画像をもとに、CodexへWebアプリ開発を依頼するための実装仕様です。  
対象アプリは、大学・ゼミ・グループワークで各メンバーが作成したPowerPointファイルをオンライン上の「ルーム」に集約し、提出状況確認、スライド順番調整、結合、PPTX/PDF出力まで行うサービスです。

---

## 1. アプリ概要

### アプリ名

SlideRoom

### コンセプト

みんなのスライドを、ひとつの発表に。

### 主要価値

- グループ発表用のPPTXをオンラインで集約できる
- メンバーごとの提出状況を確認できる
- スライド順番を視覚的に並び替えできる
- 最終的に1つのPPTXとして出力できる
- 学生でも迷わず使える、公共サービス風の安心感あるUI

### 想定ユーザー

- 大学・短大・専門学校の学生
- ゼミ・授業・グループワークの発表チーム
- 教員、TA、学生リーダー
- 社内研修・勉強会で資料をまとめるチーム

---

## 2. MVPの範囲

最初の開発では、以下をMVPとします。

### 必須機能

- ホーム画面
- ルーム一覧画面
- ルーム詳細画面
- メンバー一覧表示
- 提出ファイル一覧表示
- PPTX/PDF/DOCX/XLSXファイルのアップロードUI
- 提出状況ステータス表示
- スライド順番画面
- ドラッグ&ドロップによる並び替えUI
- 結合タブ画面
- PPTX出力ボタン、PDF出力ボタン
- 設定画面
- PC/スマホのレスポンシブ対応

### MVPではモックでもよい機能

- 実際のPPTX内部解析
- 実際のPPTX完全結合
- 実際のPowerPointサムネイル生成
- ログイン認証
- メール通知
- リアルタイム同期

### MVPの実装方針

最初は「UI完成度」と「操作フロー」を優先します。  
ファイル結合処理は `mergeService` として抽象化し、最初はダミーのBlob出力でよいです。あとから本物のPPTX結合エンジンに差し替えられる設計にします。

---

## 3. 参考モック画像

以下の画像をUI実装の基準にしてください。

| No | ファイル | 内容 |
|---:|---|---|
| 1 | `mockups/01_home_selected_reference.jpeg` | 採用するホーム画面の基準デザイン |
| 2 | `mockups/02_room_list_tab.png` | アプリ全体のルーム一覧タブ |
| 3 | `mockups/03_room_detail_overview.png` | ルーム詳細の概要画面 |
| 4 | `mockups/04_room_detail_files_tab.png` | ルーム内の提出ファイル画面 |
| 5 | `mockups/05_global_files_tab.png` | アプリ全体の提出ファイルタブ |
| 6 | `mockups/06_room_slide_order_tab.png` | ルーム内のスライド順番画面 |
| 7 | `mockups/07_merge_tab.png` | アプリ全体の結合タブ |
| 8 | `mockups/08_settings_tab.png` | 設定タブ |

---

## 4. デザイン方針

### 4.1 トーン

- マイナポータル風の公共サービスUI
- 青と白を基調にした安心感ある画面
- 派手さよりも、整理感・信頼感・分かりやすさを優先
- 学生向けなので、行政UIより少し軽く親しみやすくする

### 4.2 UIキーワード

- 白背景
- 青アクセント
- 薄い罫線
- カード型UI
- アイコン付き見出し
- 太字の重要ラベル
- ステータスバッジ
- 余白広め
- 角丸
- 影は控えめ
- 情報をブロック単位で整理

### 4.3 カラートークン

```css
:root {
  --color-primary: #0057d9;
  --color-primary-dark: #003f9e;
  --color-primary-soft: #eaf2ff;
  --color-bg: #f6f8fb;
  --color-surface: #ffffff;
  --color-border: #d9e2ef;
  --color-text: #102033;
  --color-text-muted: #64748b;
  --color-success: #16a34a;
  --color-success-soft: #e8f7ee;
  --color-warning: #f59e0b;
  --color-warning-soft: #fff7e6;
  --color-danger: #ef4444;
  --color-danger-soft: #fff0f0;
  --color-info: #2563eb;
}
```

### 4.4 フォント

```css
font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", sans-serif;
```

### 4.5 角丸・余白

```css
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
```

### 4.6 レスポンシブ方針

#### PC

- 横幅は最大1280px程度
- 上部にグローバルナビ
- メインコンテンツは2カラムまたは3カラム
- 表形式、カード、右サイドパネルを活用

#### スマホ

- 下部固定ナビゲーション
- 1カラム縦スクロール
- カード型リスト中心
- PCの表はカードリストに変換
- 主要ボタンは横幅いっぱいに近くする

---

## 5. グローバルナビゲーション

### タブ構成

1. ホーム
2. ルーム
3. 提出ファイル
4. 結合
5. 設定

### PCヘッダー

- 左：SlideRoomロゴ
- 中央：タブナビゲーション
- 右：ヘルプ、お知らせ、ユーザー名、メニュー

### スマホヘッダー

- 左：ハンバーガーメニュー
- 中央：SlideRoomロゴ
- 右：通知ベル

### スマホ下部ナビ

- ホーム
- ルーム
- 提出ファイル
- 結合
- 設定

---

## 6. 画面一覧とルーティング

React Router または Next.js App Router を想定します。

| 画面 | パス例 | 内容 |
|---|---|---|
| ホーム | `/` | 全体ダッシュボード |
| ルーム一覧 | `/rooms` | 参加中ルーム一覧 |
| ルーム詳細 概要 | `/rooms/:roomId` | 選択ルームの概要 |
| ルーム詳細 メンバー | `/rooms/:roomId/members` | メンバー管理 |
| ルーム詳細 提出ファイル | `/rooms/:roomId/files` | ルーム内ファイル管理 |
| ルーム詳細 スライド順番 | `/rooms/:roomId/order` | スライド順番調整 |
| 全体提出ファイル | `/files` | 全ルームの提出ファイル一覧 |
| 結合 | `/merge` | 結合対象確認・出力 |
| 設定 | `/settings` | アカウント・通知・表示・出力設定 |

---

## 7. ホーム画面仕様

### 目的

ユーザーがアプリ全体の状況を確認し、すぐにルーム作成・参加・最近の作業に移動できる画面。

### PC構成

- ページタイトル「ホーム」
- 説明文「グループ発表のスライド提出・管理・結合をかんたんに行えます。」
- ヒーローカード
  - イラスト
  - 「ルームを作って、みんなでスライドをまとめよう」
  - 「ルームを作成」ボタン
  - 「ルームに参加」ボタン
- 概要カード
  - アクティブルーム数
  - 提出済みファイル数
  - 未対応タスク数
- 最近のルーム
- やること
- お知らせ
- かんたん3ステップ

### スマホ構成

- ページタイトル
- 青いヒーローカード
- ルーム作成/参加ボタン
- 2列の概要カード
- 最近のルーム
- やること
- 下部ナビ

### 主要操作

- ルーム作成モーダルを開く
- 参加コード入力モーダルを開く
- 最近のルームをタップしてルーム詳細へ遷移

---

## 8. ルーム一覧タブ仕様

### 目的

参加中・作成済みの発表ルームを一覧管理する。

### 機能

- ルーム検索
- ステータスフィルタ
  - すべて
  - 進行中
  - 提出待ち
  - 結合準備OK
  - 完了
- 新しいルーム作成
- 参加中ルーム一覧
- ルーム概要カード
- 最近のアクティビティ
- 担当と進捗

### ルームカード表示項目

- アイコン
- ルーム名
- 授業名・チーム名
- 提出期限
- メンバー数
- 提出済み数 / 合計数
- ステータスバッジ
- 詳細遷移アイコン

### ステータス

- `pending` 提出待ち
- `active` 進行中
- `ready` 結合準備OK
- `done` 完了

---

## 9. ルーム詳細画面仕様

### 共通ヘッダー

- 戻るリンク「ルーム一覧に戻る」
- ルームアイコン
- ルーム名
- ステータスバッジ
- 授業名
- 発表日時
- 提出期限
- 招待URLコピー
- その他メニュー

### ルーム内タブ

- 概要
- メンバー
- 提出ファイル
- スライド順番
- 設定

---

## 10. ルーム詳細：概要タブ仕様

### 表示内容

- 進捗状況
  - 提出率リング
  - 提出済み人数
  - 未提出人数
  - 合計メンバー数
- ルーム情報
  - 作成者
  - 作成日
  - ルームID
  - 公開設定
  - 編集権限
  - 説明文
- やること
  - 未提出メンバーあり
  - スライド順番の調整が必要
  - 結合できる状態になりました
- メンバー一覧
- スライド構成
- 最近の更新
- 次のステップ

### 次のステップカード

- 提出ファイルを確認する
- スライド順番を調整する
- PPTXを出力する

---

## 11. ルーム詳細：提出ファイルタブ仕様

### 目的

そのルームに提出されたファイルを確認・管理する。

### 表示内容

- ファイルアップロードエリア
  - ドラッグ&ドロップ
  - ファイルをアップロードボタン
  - 対応形式
  - 最大サイズ
- 提出状況カード
  - 提出済み
  - 未提出
  - 修正依頼
  - 合計ファイル
- 提出ファイル一覧
- 最近の更新
- 提出ルール
- 次のステップ

### ファイル一覧項目

- ファイル名
- 提出者
- 担当範囲
- 更新日時
- 状態
- 操作
  - プレビュー
  - コメント
  - その他

---

## 12. アプリ全体：提出ファイルタブ仕様

### 目的

すべてのルームに提出されたファイルを横断的に確認する。

### 表示内容

- ページタイトル「提出ファイル」
- 検索欄
- フィルタ
  - すべて
  - 提出済み
  - 未提出
  - 修正依頼
- 並び替え
  - 最近更新
  - 期限が近い
  - ルーム名
- ファイルアップロードボタン
- 集計カード
  - 提出済みファイル
  - 未提出
  - 修正依頼
  - 総ファイル数
- 提出ファイル一覧
- 右パネル
  - 最近の更新
  - 提出ルール

### PC表示

表形式で表示する。

### スマホ表示

カード形式で表示する。

---

## 13. ルーム詳細：スライド順番画面仕様

### 目的

アップロード済みの各スライドを並び替え、発表順を確定する。

### 表示内容

- スライド順番一覧
- ドラッグハンドル
- スライド番号
- サムネイル
- スライドタイトル
- 担当者
- 元ファイル名
- ページ範囲
- 順番チェック
- 担当と枚数
- 次の操作

### 操作

- ドラッグ&ドロップで並び替え
- 並び順を保存
- 結合プレビューへ移動
- 提出ファイル確認へ戻る

### 順番チェック項目

- 未配置スライドなし
- 重複スライド番号なし
- 合計スライド数

### DnD実装候補

- `@dnd-kit/core`
- `@dnd-kit/sortable`

---

## 14. 結合タブ仕様

### 目的

提出済みスライドを1つのプレゼン資料として書き出す。

### 表示内容

- ページタイトル「結合」
- 対象ルームカード
  - ルーム名
  - 合計スライド数
  - メンバー数
  - 状況
- 結合プレビュー
  - 大きなプレビュー画像
  - サムネイル列
  - 結合プレビューを開くボタン
- 結合チェック
  - 未配置スライドなし
  - 重複スライド番号なし
  - 16:9で統一
  - 提出済みファイルをすべて含む
- 出力設定
  - ファイル名
  - 出力形式 PPTX/PDF
  - ページ番号を付ける
  - 表紙スライドを含める
- 最近の出力
- PPTXを書き出すボタン
- PDFも出力ボタン

### 出力ボタン動作

MVPでは、クリック時に以下のどちらかでよいです。

1. ダミーのPPTXファイルをダウンロードする
2. 「出力処理を開始しました」というトーストを表示する

将来的には `mergeService.exportPptx(roomId, options)` を呼び出します。

---

## 15. 設定タブ仕様

### 目的

アカウント、通知、表示、出力、セキュリティ設定を管理する。

### 表示内容

- 上部ステータスカード
  - 通知 有効
  - 表示 ライト
  - 出力 PPTX
  - セキュリティ 安全
- 左側メニュー（PC）
  - アカウント
  - 通知
  - 表示
  - 出力
  - セキュリティ
  - ヘルプ
- アカウント情報
  - アイコン
  - 名前
  - メール
  - 権限
  - プロフィール編集
  - パスワード変更
- 通知設定
  - 提出通知
  - コメント通知
  - 結合完了通知
  - 期限前リマインド
- 表示設定
  - ライト/ダーク
  - 文字サイズ
  - コンパクトビュー
- 出力設定
  - デフォルト出力形式
  - ファイル名テンプレート
  - ページ番号
  - 表紙スライド
- セキュリティ設定
  - 二段階認証
  - 招待URL有効期限
  - ログイン履歴
- ヘルプとサポート
  - 使い方ガイド
  - よくある質問
  - お問い合わせ

---

## 16. データモデル

TypeScriptで以下の型を用意してください。

```ts
export type RoomStatus = 'pending' | 'active' | 'ready' | 'done';
export type FileStatus = 'submitted' | 'missing' | 'revision' | 'checking';
export type MemberRole = 'host' | 'member' | 'viewer';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface Room {
  id: string;
  name: string;
  className: string;
  teamName?: string;
  description?: string;
  status: RoomStatus;
  iconColor: 'blue' | 'green' | 'purple' | 'orange';
  presentationDate: string;
  presentationTime: string;
  deadline: string;
  createdAt: string;
  updatedAt: string;
  hostUserId: string;
  inviteCode: string;
  memberCount: number;
  submittedCount: number;
  totalSlides: number;
}

export interface Member {
  id: string;
  roomId: string;
  userId: string;
  name: string;
  role: MemberRole;
  avatarUrl?: string;
  isSubmitted: boolean;
  assignedRange?: string;
}

export interface SubmittedFile {
  id: string;
  roomId: string;
  fileName: string;
  fileType: 'pptx' | 'ppt' | 'pdf' | 'docx' | 'xlsx';
  submitterId: string;
  submitterName: string;
  assignedSlideRange?: string;
  slideCount?: number;
  fileSize: number;
  status: FileStatus;
  uploadedAt: string;
  updatedAt: string;
  url?: string;
}

export interface SlideItem {
  id: string;
  roomId: string;
  order: number;
  section?: string;
  title: string;
  thumbnailUrl?: string;
  ownerId: string;
  ownerName: string;
  sourceFileId: string;
  sourceFileName: string;
  sourcePageRange: string;
}

export interface MergeOptions {
  roomId: string;
  fileName: string;
  format: 'pptx' | 'pdf';
  includeCover: boolean;
  includePageNumbers: boolean;
}
```

---

## 17. 初期モックデータ

最低限、以下のダミーデータを用意してください。

### ユーザー

- 山田 太郎
- yamasda.taro@example.com
- 権限：管理者

### ルーム

1. 環境問題に関する発表
   - 3年1組 総合学習
   - ステータス：提出待ち
   - メンバー：8人
   - 提出：6/8
   - 合計スライド：10枚
2. 未来のまちづくり提案
   - 2年B組 探究活動
   - ステータス：進行中
   - メンバー：6人
   - 提出：4/6
3. 商品企画プレゼン
   - 2年2組 課題研究
   - ステータス：結合準備OK
   - メンバー：5人
   - 提出：5/5
4. 地域観光PR発表
   - 1年A組 総合探究
   - ステータス：進行中
   - メンバー：7人
   - 提出：2/7

### 環境問題に関する発表のスライド構成

1. 表紙 - 山田 太郎 - 山田_表紙.pptx - 1枚
2. 環境問題とは - 佐藤 花子 - 佐藤_環境問題とは.pptx - 2〜3枚
3. 現状のデータ - 田中 健 - 田中_現状データ.pptx - 1〜2枚
4. 原因と背景 - 田中 健 - 田中_原因と背景.pptx - 3〜4枚
5. 地球温暖化 - 鈴木 一郎 - 鈴木_地球温暖化.pptx - 1〜2枚
6. 海洋プラスチック - 高橋 美咲 - 高橋_海洋プラ.pptx - 1〜2枚
7. 私たちにできること - 伊藤 翔 - 伊藤_私たちにできること.pptx - 1〜2枚
8. 解決の提案 - 渡辺 優 - 渡辺_解決の提案.pptx - 1〜2枚
9. まとめ - 伊藤 翔 - 伊藤_まとめ.pptx - 1枚
10. 参考文献 - 小林 真央 - 小林_参考文献.pptx - 1枚

---

## 18. コンポーネント設計

### レイアウト系

- `AppShell`
- `TopNav`
- `MobileHeader`
- `BottomNav`
- `PageHeader`
- `RoomHeader`
- `Tabs`
- `Card`
- `StatCard`
- `SectionCard`

### ホーム系

- `HomeHero`
- `QuickActionCard`
- `RecentRoomList`
- `TodoList`
- `NoticeList`
- `ThreeStepGuide`

### ルーム系

- `RoomList`
- `RoomCard`
- `RoomSummaryPanel`
- `ActivityList`
- `ProgressPanel`
- `MemberList`
- `RoomInternalTabs`

### ファイル系

- `UploadDropzone`
- `FileTable`
- `FileCardList`
- `FileStatusBadge`
- `RecentUpdatePanel`
- `SubmissionRulePanel`

### スライド順番系

- `SlideOrderList`
- `SlideOrderRow`
- `SlideOrderCard`
- `SlideThumbnail`
- `OrderCheckPanel`
- `AssigneeCountPanel`

### 結合系

- `MergePreview`
- `MergeCheckPanel`
- `ExportSettingsPanel`
- `RecentExportList`
- `ExportActions`

### 設定系

- `SettingsNav`
- `AccountPanel`
- `NotificationSettings`
- `DisplaySettings`
- `ExportSettings`
- `SecuritySettings`
- `HelpPanel`

---

## 19. 技術スタック案

### 推奨

- React
- TypeScript
- Vite または Next.js
- CSS Modules / Tailwind CSS / plain CSS のいずれか
- Zustand または React Context
- `@dnd-kit` for drag and drop
- `lucide-react` for icons

### MVPではおすすめ

最初はVite + React + TypeScriptで実装すると軽く始めやすいです。

```bash
npm create vite@latest slideroom -- --template react-ts
cd slideroom
npm install
npm install lucide-react @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

---

## 20. PPTX結合エンジン方針

### 20.1 注意点

PPTXは単なる画像ファイルではなく、OOXMLベースの複数XMLとメディアを含むパッケージです。完全なPPTX結合では、スライド本体だけでなく、リレーション、画像、テーマ、レイアウト、マスター、コンテンツタイプなどを整合させる必要があります。

### 20.2 MVPでの扱い

MVPではUIと画面遷移を完成させ、結合処理は以下のどちらかにします。

- ダミー出力
- 提出ファイルをZIPとしてまとめる簡易出力

### 20.3 将来の実装案

#### 案A：OOXMLを直接マージ

- PPTXをZIPとして読み込む
- 各pptxからslideパーツを取得
- media、rels、theme、layoutをコピー
- `presentation.xml` の `sldIdLst` を更新
- content typesを更新
- 新しいPPTXを生成

長所：編集可能なPPTXを維持しやすい  
短所：実装難易度が高い

#### 案B：各スライドを画像化してPPTXに再配置

- サーバーでLibreOffice等を使って各PPTXを画像化
- 画像をPptxGenJS等で新規PPTXに貼る

長所：見た目が崩れにくい  
短所：スライド内の文字や図形は編集できなくなる

#### 案C：PDF結合を先に実装

- 各PPTXをPDF化
- PDFを結合
- PPTX出力は後回し

長所：提出用としては実用的  
短所：本来のPPTX結合とは異なる

### 20.4 サービス層の抽象化

```ts
export interface MergeService {
  exportPptx(roomId: string, options: MergeOptions): Promise<Blob>;
  exportPdf(roomId: string, options: MergeOptions): Promise<Blob>;
  validateRoom(roomId: string): Promise<MergeValidationResult>;
}
```

UIはこのサービスだけを呼び、内部実装は後から差し替え可能にしてください。

---

## 21. 状態管理

### グローバル状態

- 現在のユーザー
- ルーム一覧
- 選択中ルーム
- 提出ファイル一覧
- スライド順番
- 通知
- 設定

### UI状態

- 選択中タブ
- モーダル表示
- フィルタ
- 検索キーワード
- 並び替え条件
- アップロード中状態
- 出力中状態

---

## 22. 主要ユーザーフロー

### フロー1：ルーム作成

1. ホームで「ルームを作成」クリック
2. ルーム名、授業名、期限を入力
3. ルーム作成
4. ルーム詳細へ遷移
5. 招待URLをコピー

### フロー2：ファイル提出

1. ルーム詳細へ入る
2. 提出ファイルタブを開く
3. ファイルをドラッグ&ドロップ
4. 提出ファイル一覧に追加
5. 提出状況が更新される

### フロー3：スライド順番調整

1. ルーム詳細のスライド順番タブを開く
2. スライド一覧を確認
3. ドラッグ&ドロップで順番変更
4. 「順番を保存」
5. 結合プレビューへ進む

### フロー4：結合出力

1. 結合タブを開く
2. 対象ルームを確認
3. 結合チェックを確認
4. 出力形式を選択
5. PPTXを書き出す
6. ダウンロード

---

## 23. アクセシビリティ要件

- 文字サイズは基本14px以上
- 主要ボタンは44px以上の高さ
- 色だけで状態を表さず、テキストとアイコンも併用
- フォーカスリングを表示
- ボタンには `aria-label` を設定
- 入力欄にはラベルを設定
- スマホで横スクロールを極力発生させない

---

## 24. 実装順序

### Phase 1：UI基盤

- Vite/Nextプロジェクト作成
- デザイントークン定義
- AppShell作成
- TopNav / BottomNav作成
- モックデータ作成

### Phase 2：主要画面

- ホーム
- ルーム一覧
- ルーム詳細概要
- ルーム内提出ファイル
- アプリ全体提出ファイル
- スライド順番
- 結合
- 設定

### Phase 3：操作機能

- ルーム作成モーダル
- ルーム参加モーダル
- ファイルアップロードUI
- ドラッグ&ドロップ並び替え
- フィルタ・検索
- トースト通知

### Phase 4：擬似バックエンド

- localStorage保存
- mock API層
- mergeServiceのダミー実装

### Phase 5：実バックエンド化

- 認証
- DB
- ファイルストレージ
- PPTX結合処理
- PDF出力処理

---

## 25. 受け入れ条件

### UI

- PCとスマホでモック画像の雰囲気に近い
- 青白ベースの公共サービス風UIになっている
- 5タブが動作する
- ルーム詳細内タブが動作する
- カード、表、バッジ、ボタンのデザインが統一されている

### 操作

- ルーム一覧から詳細へ遷移できる
- 提出ファイル一覧を表示できる
- スライド順番をドラッグで変更できる
- 順番保存ボタンを押すと状態が反映される
- 結合画面でPPTX/PDF出力ボタンを押せる
- 設定画面のトグルが操作できる

### レスポンシブ

- 1024px以上ではPCレイアウト
- 768px未満ではスマホレイアウト
- スマホでは下部ナビが表示される
- 表はスマホでカードリストに変換される

---

## 26. Codexへの注意事項

- まずは完全なUI再現を優先してください。
- 本物のPPTX結合は最初から無理に実装しないでください。
- PPTX結合処理はサービス層に分離してください。
- モックデータで全画面を動作させてください。
- スマホ表示を必ず確認してください。
- 画像モックの雰囲気を保ちつつ、文字が読めるUIを優先してください。
- コンポーネント分割を丁寧に行ってください。
- 1ファイル巨大実装ではなく、保守しやすい構成にしてください。

---

## 27. 推奨ディレクトリ構成

```txt
src/
  app/
    App.tsx
    routes.tsx
  components/
    layout/
    common/
    home/
    rooms/
    files/
    order/
    merge/
    settings/
  data/
    mockData.ts
  types/
    index.ts
  services/
    roomService.ts
    fileService.ts
    mergeService.ts
  styles/
    tokens.css
    global.css
  utils/
    format.ts
```

---

## 28. 参考技術メモ

- PptxGenJSはJavaScriptでPowerPointファイルを生成するライブラリです。
- PPTXはPresentationML/OOXMLの構造を持つパッケージであり、完全結合には内部XMLと関連ファイルの整合性が必要です。
- JSZipはJavaScriptでZIPファイルの作成・読み込み・編集ができるライブラリです。

---

## 29. 最終的に目指す完成イメージ

SlideRoomは、単なるPPTX結合ツールではなく、以下を一体化したグループ発表支援アプリです。

- ルーム作成
- メンバー参加
- 提出状況管理
- スライド順番調整
- 結合プレビュー
- PPTX/PDF出力

最初は大学のゼミ・授業発表に特化し、学生が迷わず使える軽量なWebアプリとして完成させます。
