# SlideRoom UI完成後・機能実装設計書

## 0. この設計書の目的

この設計書は、**UIモック再現が完了した後**に、Codexへ「実際に使えるアプリ」として機能実装を依頼するための仕様書です。

前回の設計書は、ホーム・ルーム・提出ファイル・スライド順番・結合・設定などの画面UIを完成させることが目的でした。  
本設計書では、UI完成後に以下を実装します。

- 画面間の実データ連携
- ルーム作成・参加・編集
- ファイルアップロード管理
- 提出状況管理
- スライド順番の保存
- 結合プレビューと出力処理
- 設定の永続化
- エラー・空状態・ローディング状態
- 完成版として動くMVP

---

## 1. 前提条件

### 1.1 すでに完了している想定

- React + TypeScript + Vite でアプリが起動する
- 主要画面のUIがモック画像に近い形で実装済み
- PCとスマホのレスポンシブ表示がある
- グローバルナビがある
- ルーム詳細内タブがある
- スライド順番画面にドラッグ&ドロップUIがある
- 結合タブと設定タブのUIがある

### 1.2 今回やること

UIの見た目は大きく変えず、**状態管理・データ処理・ユーザー操作・保存処理・疑似的なPPTX出力**を実装します。

---

## 2. 実装フェーズ全体像

### Phase 1: アプリ内データ基盤

- TypeScript型定義
- モックデータ整理
- 状態管理
- 永続化
- 共通ユーティリティ

### Phase 2: ルーム機能

- ルーム作成
- ルーム参加
- ルーム編集
- ルーム削除・アーカイブ
- ルーム検索・絞り込み

### Phase 3: メンバー・提出状況

- メンバー管理
- ロール管理
- 提出済み・未提出の自動計算
- 進捗率計算

### Phase 4: ファイル提出管理

- ファイルアップロード
- ファイル差し替え
- ファイル削除
- バージョン履歴
- バリデーション
- 提出ステータス更新

### Phase 5: スライド順番管理

- ファイルからスライドデータ生成
- スライド単位の並び替え
- 並び順保存
- 重複・未配置チェック
- セクション分け

### Phase 6: 結合・出力

- 結合対象確認
- 出力設定
- 疑似PPTX出力
- 疑似PDF出力
- 出力履歴
- エラー表示

### Phase 7: 設定・通知・UX仕上げ

- 設定保存
- トースト通知
- ローディング状態
- 空状態
- 確認ダイアログ
- アクセシビリティ調整

### Phase 8: 完成チェック

- 動作確認
- レスポンシブ確認
- 主要操作テスト
- README整備

---

## 3. 推奨技術構成

### 3.1 既存UIを前提に追加するライブラリ

```bash
npm install zustand idb nanoid date-fns sonner
npm install pptxgenjs jszip file-saver
```

### 3.2 役割

| ライブラリ | 用途 |
|---|---|
| zustand | アプリ全体の状態管理 |
| idb | IndexedDBラッパー。アップロードファイル保存に使用 |
| nanoid | ルームID、ファイルIDなどの生成 |
| date-fns | 日付表示・期限計算 |
| sonner | トースト通知 |
| pptxgenjs | MVP用の疑似PPTX生成 |
| jszip | PPTX/ZIP内部処理の将来拡張用、または一括ZIP出力 |
| file-saver | Blobのダウンロード |

### 3.3 注意

既存PPTXを完全に読み込んで、そのまま結合する処理はMVPでは必須にしません。  
MVPでは、アップロードされたファイル情報とスライド順番データをもとに、**確認用の簡易PPTX**を生成します。

本格的な既存PPTX結合は、後述の `MergeEngine` インターフェースに差し替え可能な形で設計します。

---

## 4. ディレクトリ構成

既存構成がある場合は無理に変更しなくてよいですが、以下を目標に整理してください。

```txt
src/
  app/
    App.tsx
    router.tsx
  components/
    layout/
      AppShell.tsx
      TopNav.tsx
      BottomNav.tsx
      PageHeader.tsx
    ui/
      Button.tsx
      Card.tsx
      Badge.tsx
      Modal.tsx
      ConfirmDialog.tsx
      EmptyState.tsx
      Loading.tsx
      ToastProvider.tsx
      FileDropzone.tsx
      StatusBadge.tsx
    room/
      RoomCard.tsx
      RoomForm.tsx
      RoomTabs.tsx
      MemberList.tsx
      ProgressPanel.tsx
    files/
      FileTable.tsx
      FileCardList.tsx
      FileUploadPanel.tsx
      FileDetailDrawer.tsx
    slides/
      SlideOrderList.tsx
      SlideThumbnail.tsx
      SlideSectionHeader.tsx
    merge/
      MergePreview.tsx
      MergeCheckPanel.tsx
      ExportSettings.tsx
      ExportHistory.tsx
    settings/
      SettingsSection.tsx
      ToggleRow.tsx
  pages/
    HomePage.tsx
    RoomsPage.tsx
    RoomDetailPage.tsx
    GlobalFilesPage.tsx
    MergePage.tsx
    SettingsPage.tsx
  stores/
    useAppStore.ts
  services/
    storageService.ts
    roomService.ts
    fileService.ts
    slideService.ts
    mergeService.ts
    exportService.ts
  data/
    seedData.ts
  types/
    index.ts
  utils/
    date.ts
    file.ts
    validation.ts
    progress.ts
```

---

## 5. TypeScript型定義

`src/types/index.ts` に以下の型を作成してください。

```ts
export type RoomStatus = 'draft' | 'in_progress' | 'waiting' | 'ready' | 'completed' | 'archived';
export type FileStatus = 'submitted' | 'not_submitted' | 'revision_requested' | 'reviewing' | 'approved' | 'excluded';
export type MemberRole = 'host' | 'admin' | 'member' | 'viewer';
export type ExportFormat = 'pptx' | 'pdf' | 'zip';

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface Room {
  id: string;
  title: string;
  className: string;
  teamName?: string;
  description?: string;
  status: RoomStatus;
  hostUserId: string;
  inviteCode: string;
  inviteUrl: string;
  presentationAt?: string;
  deadlineAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface RoomMember {
  id: string;
  roomId: string;
  userId: string;
  name: string;
  role: MemberRole;
  assignedRange?: string;
  joinedAt: string;
  isCurrentUser?: boolean;
}

export interface SubmittedFile {
  id: string;
  roomId: string;
  ownerUserId: string;
  ownerName: string;
  name: string;
  originalName: string;
  mimeType: string;
  extension: string;
  size: number;
  status: FileStatus;
  version: number;
  assignedRange?: string;
  slideCount: number;
  storageKey?: string;
  objectUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SlideItem {
  id: string;
  roomId: string;
  fileId: string;
  ownerUserId: string;
  ownerName: string;
  title: string;
  section: string;
  order: number;
  sourcePage: number;
  thumbnailUrl?: string;
  isPlaced: boolean;
  isDuplicate?: boolean;
}

export interface RoomProgress {
  roomId: string;
  totalMembers: number;
  submittedMembers: number;
  notSubmittedMembers: number;
  totalFiles: number;
  totalSlides: number;
  progressRate: number;
}

export interface ExportSettings {
  format: ExportFormat;
  fileName: string;
  includeCover: boolean;
  includePageNumber: boolean;
  includeSectionDivider: boolean;
  includeMemberName: boolean;
}

export interface ExportRecord {
  id: string;
  roomId: string;
  fileName: string;
  format: ExportFormat;
  status: 'success' | 'failed';
  createdAt: string;
  downloadUrl?: string;
  errorMessage?: string;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  fontSize: 'small' | 'medium' | 'large';
  compactMode: boolean;
  defaultExportFormat: ExportFormat;
  includePageNumberDefault: boolean;
  includeCoverDefault: boolean;
  notifications: {
    submit: boolean;
    comment: boolean;
    mergeComplete: boolean;
    deadlineReminder: boolean;
  };
}
```

---

## 6. 状態管理

### 6.1 `useAppStore` の役割

Zustandで以下を管理します。

- currentUser
- rooms
- members
- files
- slides
- exportRecords
- settings
- selectedRoomId
- UI状態
  - loading
  - modalOpen
  - currentFilter
  - searchQuery

### 6.2 ストアに必要な操作

```ts
createRoom(input)
updateRoom(roomId, patch)
deleteRoom(roomId)
archiveRoom(roomId)
joinRoom(inviteCode, displayName)

addMember(roomId, member)
updateMember(memberId, patch)
removeMember(memberId)

addFile(roomId, file, meta)
replaceFile(fileId, file)
updateFileStatus(fileId, status)
removeFile(fileId)

createSlidesFromFile(fileId)
reorderSlides(roomId, orderedSlideIds)
updateSlide(slideId, patch)

createExport(roomId, settings)
addExportRecord(record)

updateSettings(patch)
resetSettings()
```

### 6.3 永続化

- ルーム、メンバー、ファイルメタデータ、スライド順番、設定は `localStorage` または `IndexedDB` に保存
- 実ファイルBlobは `IndexedDB` に保存
- 起動時に保存済みデータを復元
- 初回起動時のみ `seedData` を投入

---

## 7. ストレージ設計

### 7.1 MVPの保存方法

| データ | 保存先 |
|---|---|
| ルーム | localStorage または IndexedDB |
| メンバー | localStorage または IndexedDB |
| ファイルメタデータ | IndexedDB |
| ファイルBlob | IndexedDB |
| スライド順番 | localStorage または IndexedDB |
| 設定 | localStorage |
| 出力履歴 | localStorage |

### 7.2 `storageService.ts`

実装する関数例。

```ts
saveState(key, value)
loadState(key)
clearState(key)
saveBlob(storageKey, blob)
getBlob(storageKey)
deleteBlob(storageKey)
```

### 7.3 将来のバックエンド差し替え

将来的にSupabase、Firebase、Cloudflare R2などに移行できるよう、ストアから直接IndexedDBを触らず、必ず `service` 経由にしてください。

---

## 8. ルーム機能実装

### 8.1 ルーム作成

#### UI

- ホームの「ルームを作成」ボタン
- ルームタブの「新しいルーム」ボタン

#### 入力項目

- ルーム名 必須
- 授業名 任意
- チーム名 任意
- 説明 任意
- 発表日時 任意
- 提出期限 任意

#### 処理

1. 入力バリデーション
2. `roomId` と `inviteCode` を生成
3. `Room` を作成
4. 自分を `host` として `RoomMember` に追加
5. ルーム詳細へ遷移
6. トースト表示

### 8.2 ルーム参加

#### UI

- ホームの「ルームに参加」ボタン
- 招待コード入力モーダル

#### 処理

1. inviteCodeでルーム検索
2. 見つからない場合はエラー
3. すでに参加済みなら詳細へ移動
4. 未参加ならメンバーとして追加
5. ルーム詳細へ遷移

### 8.3 ルーム一覧

#### 機能

- 検索
- ステータスフィルタ
- 提出期限順ソート
- 更新日時順ソート
- カードクリックで詳細へ遷移

### 8.4 ルーム詳細

#### タブ

- 概要
- メンバー
- 提出ファイル
- スライド順番
- 設定

#### ルーム詳細ヘッダー

- ルーム名
- ステータスバッジ
- 授業名
- 発表日時
- 提出期限
- 招待URLコピー
- メニュー

---

## 9. メンバー・進捗機能

### 9.1 メンバー一覧

- 名前
- ロール
- 提出ステータス
- 担当範囲
- 最終更新

### 9.2 ロール

| ロール | 権限 |
|---|---|
| host | 全操作可能 |
| admin | ルーム編集、メンバー管理、結合可能 |
| member | 自分の提出・コメント・閲覧 |
| viewer | 閲覧のみ |

MVPでは厳密な認証は不要ですが、UI上ではロール表示と簡易制御を行ってください。

### 9.3 進捗計算

`utils/progress.ts` に以下を実装。

```ts
calculateRoomProgress(room, members, files, slides): RoomProgress
```

計算ルール。

- 提出済みメンバー数 = そのメンバーの `submitted` または `approved` ファイルが1件以上ある
- 未提出メンバー数 = 総メンバー数 - 提出済みメンバー数
- 進捗率 = 提出済みメンバー数 / 総メンバー数
- 合計スライド数 = 結合対象ファイルの slideCount 合計

---

## 10. ファイル提出機能

### 10.1 対応形式

MVPでは以下を受け付けます。

- `.pptx`
- `.ppt`
- `.pdf`
- `.docx`
- `.xlsx`

ただし、結合対象にするのは基本 `.pptx` と `.pdf` のみでよいです。

### 10.2 ファイルバリデーション

`utils/validation.ts` に実装。

```ts
validateUploadFile(file: File): ValidationResult
```

ルール。

- 最大サイズ: 200MB
- 許可拡張子のみ
- ファイル名が空でない
- 同名ファイルはバージョン更新扱い

### 10.3 アップロード処理

1. ファイル選択またはドラッグ&ドロップ
2. バリデーション
3. BlobをIndexedDBへ保存
4. メタデータを作成
5. slideCountを仮生成
   - PPTX: 1〜5枚程度を仮設定、またはファイル名から既存モックと合わせる
   - PDF: 1〜10枚程度を仮設定
6. 提出ファイル一覧に追加
7. 対応するSlideItemを作成
8. トースト表示

### 10.4 ファイル差し替え

- 同じ提出者・同じ担当範囲・同名に近いファイルの場合、旧ファイルをversion+1で差し替え
- 旧ファイルは履歴に残す設計にしてもよい
- MVPでは旧ファイルを `excluded` にして新ファイルを追加でもよい

### 10.5 ファイルステータス

- 提出済み
- 未提出
- 修正依頼
- 確認中
- 結合対象外

### 10.6 ファイルプレビュー

MVPでは本物のPowerPointレンダリングは不要です。

- PPTXの場合: ダミーサムネイルカード
- PDFの場合: ブラウザで表示可能ならObjectURLで開く
- その他形式: ファイル情報のみ表示

---

## 11. スライド順番機能

### 11.1 スライドデータ生成

ファイル追加時に `SlideItem` を生成します。

例。

```ts
for (let i = 1; i <= file.slideCount; i++) {
  createSlide({
    title: inferSlideTitle(file.name, i),
    sourcePage: i,
    order: nextOrder,
    section: inferSection(i),
  })
}
```

### 11.2 セクション

MVPでは以下のセクションを用意してください。

- 導入
- 本論
- まとめ

余裕があれば以下も追加。

- 表紙
- 現状の課題
- 原因と背景
- 解決策
- 参考文献

### 11.3 並び替え

- `@dnd-kit/sortable` を使用
- PCはテーブル風
- スマホはカードリスト
- 並び替え後は即ストアに保存
- 「順番を保存」ボタンでも保存完了トースト

### 11.4 順番チェック

以下を表示。

- 未配置スライド数
- 重複スライド番号数
- 合計スライド数
- 各メンバーの担当枚数

MVPでは実際の未配置判定は `isPlaced` で管理してください。

---

## 12. 結合・出力機能

### 12.1 結合画面の目的

スライド順番画面で決めた順番をもとに、最終出力する前の確認・設定・ダウンロードを行います。

### 12.2 結合チェック

表示する項目。

- 未配置スライドはありません
- 重複スライド番号はありません
- 16:9で統一されています
- 提出済みファイルをすべて含んでいます

MVPでは実データから以下のみ計算。

- totalSlides
- unplacedSlides
- duplicateOrderCount
- includedFilesCount

### 12.3 出力設定

- ファイル名
- PPTX / PDF
- ページ番号を付ける
- 表紙スライドを含める
- セクション区切りを含める
- 担当者名を含める

### 12.4 `mergeService.ts`

以下のインターフェースを定義してください。

```ts
export interface MergeEngine {
  analyzeFile(file: SubmittedFile): Promise<FileAnalysis>;
  buildPreview(roomId: string): Promise<MergePreviewData>;
  exportPptx(roomId: string, settings: ExportSettings): Promise<Blob>;
  exportPdf(roomId: string, settings: ExportSettings): Promise<Blob>;
}
```

### 12.5 MVP用の実装

`DummyMergeEngine` または `PptxGenMergeEngine` を作成します。

#### PPTX出力

PptxGenJSで以下の簡易PPTXを生成。

- 表紙
- スライド順番リストに対応する簡易スライド
- 各スライドに以下を表示
  - スライド番号
  - タイトル
  - 担当者
  - 元ファイル名
- 最終ページに「SlideRoomで出力」表記

これは本物の既存PPTX結合ではありませんが、操作フロー確認用として十分です。

#### PDF出力

MVPでは以下のどちらかでよいです。

- 「PDF出力は現在準備中」というトースト
- または簡易テキストPDF風Blobを出力

PDF実装は後回しで構いません。

### 12.6 将来の本格結合

本格的に既存PPTXを結合する場合は、以下のどちらかを検討します。

#### A. サーバーサイド変換方式

- アップロードされたPPTXをサーバーで処理
- LibreOffice headless などでPDF化・画像化
- 最終PPTXを再生成
- 再現性は高めだがサーバーが必要

#### B. OOXML直接編集方式

- PPTXはZIP形式なので展開
- `ppt/slides/slide*.xml`
- `ppt/_rels/presentation.xml.rels`
- `ppt/media/*`
- `ppt/theme/*`
- `ppt/slideMasters/*`
- などの関係を解決して再構成

ただし、テーマ・画像・フォント・リレーション・アニメーションが複雑なので、MVPでは避けます。

---

## 13. 設定機能

### 13.1 表示設定

- ライト/ダーク
- 文字サイズ
- コンパクト表示

### 13.2 通知設定

- 提出通知
- コメント通知
- 結合完了通知
- 期限前リマインド

### 13.3 出力設定

- デフォルト出力形式
- ページ番号初期値
- 表紙追加初期値
- ファイル名テンプレート

### 13.4 保存

設定変更時に即localStorageへ保存します。

---

## 14. UX実装

### 14.1 トースト通知

以下の操作で表示。

- ルーム作成完了
- ルーム参加完了
- 招待URLコピー完了
- ファイルアップロード完了
- ファイル削除完了
- 並び順保存完了
- 出力完了
- エラー発生

### 14.2 確認ダイアログ

以下の操作では確認を出してください。

- ルーム削除
- ファイル削除
- メンバー削除
- 設定リセット
- 出力履歴削除

### 14.3 空状態

以下の状態を用意。

- ルームがまだない
- ファイルがまだ提出されていない
- 検索結果がない
- 出力履歴がない

### 14.4 ローディング状態

- 初期データ読込中
- ファイルアップロード中
- 出力中

---

## 15. ルーティングと画面遷移

| 操作 | 遷移先 |
|---|---|
| ホーム > ルーム作成 | 作成モーダル表示、作成後 `/rooms/:roomId` |
| ホーム > ルーム参加 | 参加モーダル表示、参加後 `/rooms/:roomId` |
| 最近のルームクリック | `/rooms/:roomId` |
| ルーム一覧カードクリック | `/rooms/:roomId` |
| ルーム詳細 > 提出ファイル | `/rooms/:roomId/files` |
| ルーム詳細 > スライド順番 | `/rooms/:roomId/order` |
| スライド順番 > 結合プレビュー | `/merge?roomId=:roomId` |
| 結合 > 出力完了 | 同画面で履歴追加 |

---

## 16. 入力バリデーション

### 16.1 ルーム作成

- ルーム名必須
- ルーム名は50文字以内
- 提出期限が発表日時より後の場合は警告

### 16.2 ファイルアップロード

- 許可形式のみ
- 最大200MB
- 同名ファイルは確認

### 16.3 出力

- スライドが0枚なら出力不可
- ファイル名必須
- 拡張子は自動付与

---

## 17. 受け入れ条件

### 17.1 基本

- `npm install` が成功する
- `npm run dev` で起動する
- コンソールに致命的エラーがない
- PCとスマホ幅で崩れない

### 17.2 ルーム

- ルームを作成できる
- 作成後に一覧とホームへ反映される
- ルーム詳細へ遷移できる
- 招待コードで参加できる
- 検索とフィルタが動く

### 17.3 ファイル

- ファイルをアップロードできる
- 一覧へ反映される
- ステータスが更新される
- 削除できる
- 進捗率へ反映される

### 17.4 スライド順番

- ファイル追加後にスライドデータが生成される
- ドラッグ&ドロップで並び替えできる
- 並び順が保存される
- 再読み込み後も順番が維持される

### 17.5 結合

- 結合画面で選択ルームの情報が表示される
- 出力設定を変更できる
- PPTX出力ボタンでBlobを生成しダウンロードできる
- 出力履歴が追加される

### 17.6 設定

- トグルが動く
- 設定が保存される
- 再読み込み後も設定が保持される

---

## 18. テスト観点

### 18.1 手動テスト

1. 初回起動
2. ホーム表示
3. ルーム作成
4. ファイルアップロード
5. スライド順番変更
6. 結合出力
7. 設定変更
8. 再読み込み
9. データ保持確認
10. スマホ幅確認

### 18.2 エラーケース

- 対応外ファイルをアップロード
- 大きすぎるファイルをアップロード
- 空のルーム名で作成
- 存在しない招待コードで参加
- スライド0枚で出力
- ファイル削除後の進捗再計算

---

## 19. 完成後のREADMEに書くこと

- アプリ概要
- 使用技術
- 起動方法
- 主要機能
- MVPでできること
- まだ本格実装していないこと
- PPTX結合の今後の実装方針

---

## 20. Codexへの重要指示

- UIの見た目を大幅に変えない
- 既存UIを壊さず機能を接続する
- ダミーデータから実データ管理へ移行する
- ストアとサービス層を分離する
- PPTX完全結合はMVPでは不要
- ただし `mergeService` は将来差し替え可能にする
- PCとスマホの使いやすさを維持する
- 1回で全実装が難しい場合は、Phaseごとに実装する

---

## 21. 最終ゴール

このフェーズの最終ゴールは、以下の状態です。

> UIだけのモックではなく、ルーム作成からファイル提出、スライド順番調整、簡易PPTX出力まで一通り操作できるSlideRoomのMVPを完成させる。
