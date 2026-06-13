# Supabase email OTP template

SlideRoomの新規登録は、確認URLではなく6桁のメールOTPを入力する方式です。

アプリ側は `verifyOtp({ type: "signup" })` で6桁コードを確認します。Supabaseのメール本文に `{{ .Token }}` が入っていない場合、ユーザーには確認URLだけが届き、`check-email` 画面に入力するコードが届きません。

## 設定場所

Supabase Dashboardで以下を設定します。

1. 対象プロジェクトを開く
2. Authentication
3. Emails
4. Templates
5. Confirm signup
6. SubjectとBodyをOTP用に変更する

## Subject

```text
SlideRoomの認証コード
```

## Body

`supabase/email_templates/confirm_signup_otp.html` の内容を貼り付けます。

重要なのは、本文に次の変数を含めることです。

```text
{{ .Token }}
```

`{{ .ConfirmationURL }}` を使うとURL確認メールになります。6桁入力方式では使いません。

## 動作確認

1. SlideRoomで新規登録する
2. メール本文に6桁の数字が表示されることを確認する
3. `check-email` 画面に6桁の数字を入力する
4. 認証成功後、ログイン画面を挟まずにマイルームへ進むことを確認する

メールが見つからない場合は、迷惑メールフォルダに分類されている可能性があります。
