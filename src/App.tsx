import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  FileUp,
  FolderPlus,
  House,
  KeyRound,
  ListOrdered,
  Lock,
  LogOut,
  LogIn,
  Mail,
  PlusCircle,
  Save,
  Settings,
  ShieldCheck,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { saveAs } from "file-saver";
import { Toaster, toast } from "sonner";
import previewHero from "./assets/slide-preview-hero.png";
import { mergeService } from "./services/mergeService";
import { createPptxSlidePreviewSvgs } from "./services/pptxPreviewService";
import { getBlob } from "./services/storageService";
import { useAppStore } from "./stores/useAppStore";
import type { ExportFormat, ExportSettings, Room, RoomMember, SlideItem, SubmittedFile } from "./types";
import { formatFileSize } from "./utils/format";

type AppPage = "home" | "login" | "register" | "check-email" | "forgot" | "account" | "create" | "join" | "room" | "order" | "preview";

interface AppRoute {
  page: AppPage;
  roomId?: string;
  inviteCode?: string;
}

function parseHash(): AppRoute {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "login") return { page: "login" };
  if (parts[0] === "register") return { page: "register" };
  if (parts[0] === "check-email") return { page: "check-email" };
  if (parts[0] === "forgot") return { page: "forgot" };
  if (parts[0] === "account") return { page: "account" };
  if (parts[0] === "create") return { page: "create" };
  if (parts[0] === "join") return { page: "join", inviteCode: parts[1] };
  if (parts[0] === "room" && parts[1] && parts[2] === "order") return { page: "order", roomId: parts[1] };
  if (parts[0] === "room" && parts[1] && parts[2] === "preview") return { page: "preview", roomId: parts[1] };
  if (parts[0] === "room" && parts[1]) return { page: "room", roomId: parts[1] };
  return { page: "home" };
}

function navigate(path: string) {
  window.location.hash = path;
}

function createLocalInviteUrl(inviteCode: string) {
  return `${window.location.origin}/#/join/${inviteCode}`;
}

function useHashRoute() {
  const [route, setRoute] = useState<AppRoute>(() => parseHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function App() {
  const route = useHashRoute();
  const { rooms, selectedRoomId, syncFromServer, initializeAuth, isAuthenticated, authReady } = useAppStore();
  const routeRoom = rooms.find((room) => room.id === route.roomId);
  const selectedRoom = routeRoom ?? rooms.find((room) => room.id === selectedRoomId) ?? rooms[0];

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  useEffect(() => {
    void syncFromServer();
  }, [syncFromServer]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [route.page, route.roomId, route.inviteCode]);

  return (
    <>
      {route.page === "home" && <HomePage room={selectedRoom} />}
      {route.page === "login" && <LoginPage />}
      {route.page === "register" && <RegisterPage />}
      {route.page === "check-email" && <CheckEmailPage />}
      {route.page === "forgot" && <ForgotPasswordPage />}
      {route.page === "account" && (authReady && isAuthenticated ? <AccountPage /> : <LoginPage />)}
      {route.page === "create" && (authReady && isAuthenticated ? <CreateRoomPage /> : <RegisterPage />)}
      {route.page === "join" && <JoinRoomPage inviteCode={route.inviteCode} />}
      {route.page === "room" && (routeRoom ? <RoomPage room={routeRoom} /> : <NotFoundPage />)}
      {route.page === "order" && (routeRoom ? <OrderPage room={routeRoom} /> : <NotFoundPage />)}
      {route.page === "preview" && (routeRoom ? <PreviewPage room={routeRoom} /> : <NotFoundPage />)}
      <Toaster richColors position="top-right" />
    </>
  );
}

function HomePage({ room: _room }: { room?: Room }) {
  const { isAuthenticated } = useAppStore();
  if (isAuthenticated) return <MyRoomsPage />;

  return (
    <main className="home-shell">
      <section className="home-card">
        <SimpleHeader action={<button className="text-link">使い方はとても簡単</button>} />
        <div className="home-hero">
          <span className="pill">PowerPoint合体を、いちばんシンプルに。</span>
          <h1>みんなの <b>PowerPoint</b> を、<br />ひとつに。</h1>
          <p>複数のPowerPointファイルをアップロードして、順番を並べるだけで、ひとつのファイルにまとめます。</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => navigate("/register")}>
              <Users size={28} /> ルームを作る
            </button>
            <button className="secondary-action" onClick={() => navigate("/join")}>
              <LogIn size={28} /> ルームに参加
            </button>
          </div>
        </div>
        <section className="steps-block">
          <div className="section-rule"><span>3ステップで、かんたん結合</span></div>
          <div className="step-grid">
            <StepCard number="1" icon={<FolderPlus />} title="ルームを作る" text="メンバーを招待します。" />
            <StepCard number="2" icon={<FileUp />} title="pptxをアップロード" text="PowerPointファイルを集めます。" />
            <StepCard number="3" icon={<ListOrdered />} title="順番を並べて書き出す" text="PPTXまたはPDFにします。" />
          </div>
        </section>
        <DemoScreenshots />
        <p className="safe-note"><ShieldCheck size={18} /> ルーム内のデータは、作成から24時間以内に自動削除されます。</p>
      </section>
    </main>
  );
}


function RegisterPage() {
  const { register } = useAppStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return toast.error("ユーザーネームを入力してください。");
    if (!email.trim()) return toast.error("メールアドレスを入力してください。");
    if (!password) return toast.error("パスワードを入力してください。");
    if (password !== confirm) return toast.error("パスワード確認が一致しません。");
    if (!agreed) return toast.error("利用規約とプライバシーポリシーへの同意をチェックしてください。");
    setSubmitting(true);
    try {
      await register({ name, email, password });
      window.sessionStorage.setItem("slideroom.pendingSignupEmail", email.trim());
      toast.success("6桁のパスコードを送信しました。メールを確認してください。");
      navigate("/check-email");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "登録できませんでした。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage>
      <form className="auth-form" onSubmit={submit}>
        <h1>新規登録</h1>
        <p>アカウントを作成すると、ルームの保存やオンライン共有ができます。</p>
        <DataExpiryNotice />
        <label className="auth-field">
          <span>ユーザーネーム</span>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="ユーザーネームを入力" autoFocus />
        </label>
        <label className="auth-field">
          <span>メールアドレス</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="メールアドレスを入力" type="email" />
        </label>
        <PasswordField
          label="パスワード"
          value={password}
          onChange={setPassword}
          placeholder="パスワードを入力"
          visible={showPassword}
          onToggle={() => setShowPassword((value) => !value)}
        />
        <PasswordField
          label="パスワード確認"
          value={confirm}
          onChange={setConfirm}
          placeholder="パスワードを再入力"
          visible={showConfirm}
          onToggle={() => setShowConfirm((value) => !value)}
        />
        <label className="terms-row">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          <span>
            <button type="button" onClick={() => setTermsOpen(true)}>利用規約</button>と
            <button type="button" onClick={() => setPrivacyOpen(true)}>プライバシーポリシー</button>に同意します
          </span>
        </label>
        <button className="wide-primary" type="submit" disabled={submitting}>{submitting ? "登録中..." : "登録する"}</button>
        <p className="auth-switch">すでにアカウントをお持ちですか？ <button type="button" onClick={() => navigate("/login")}>ログイン</button></p>
      </form>
      {termsOpen && <TermsModal onClose={() => setTermsOpen(false)} />}
      {privacyOpen && <PrivacyPolicyModal onClose={() => setPrivacyOpen(false)} />}
    </AuthPage>
  );
}

function CheckEmailPage() {
  const { verifySignupEmailCode, resendEmailVerification } = useAppStore();
  const [email, setEmail] = useState(() => window.sessionStorage.getItem("slideroom.pendingSignupEmail") ?? "");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const nextEmail = email.trim();
    const nextCode = code.trim();
    if (!nextEmail) return toast.error("メールアドレスを入力してください。");
    if (!/^\d{6}$/.test(nextCode)) return toast.error("6桁のパスコードを入力してください。");
    setVerifying(true);
    try {
      await verifySignupEmailCode({ email: nextEmail, code: nextCode });
      window.sessionStorage.removeItem("slideroom.pendingSignupEmail");
      toast.success("メール認証が完了しました。");
      navigate("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "パスコードを確認できませんでした。");
    } finally {
      setVerifying(false);
    }
  }

  async function resendCode() {
    const nextEmail = email.trim();
    if (!nextEmail) return toast.error("メールアドレスを入力してください。");
    setResending(true);
    try {
      await resendEmailVerification(nextEmail);
      toast.success("6桁のパスコードを再送信しました。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "パスコードを再送信できませんでした。");
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthPage>
      <form className="check-email-screen" onSubmit={submit}>
        <div className="check-email-icon" aria-hidden="true">
          <Mail size={64} />
        </div>
        <p className="check-email-kicker">あと少しで登録完了です</p>
        <h1>6桁のパスコードを入力してください</h1>
        <p className="check-email-lead">
          {email ? `${email} 宛に6桁のパスコードを送信しました。` : "入力したメールアドレス宛に6桁のパスコードを送信しました。"}
          メールに記載された数字を入力すると、このままSlideRoomを使い始められます。
        </p>
        {email ? (
          <div className="check-email-address">
            <span>送信先</span>
            <strong>{email}</strong>
          </div>
        ) : (
          <label className="check-email-field">
            <span>メールアドレス</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="name@example.com" />
          </label>
        )}
        <label className="check-email-field">
          <span>6桁のパスコード</span>
          <input
            className="otp-input"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="000000"
            autoFocus
          />
        </label>
        <button className="check-email-primary" type="submit" disabled={verifying}>
          {verifying ? "認証中..." : "パスコードを確認する"}
        </button>
        <p className="check-email-sub">認証が完了すると、ログインし直さずにそのまま進めます。</p>
        <div className="check-email-steps" aria-label="メール認証の手順">
          <span>1. メールを開く</span>
          <span>2. 6桁の数字を見る</span>
          <span>3. この画面に入力する</span>
        </div>
        <button className="check-email-secondary" type="button" onClick={resendCode} disabled={resending}>
          {resending ? "再送信中..." : "パスコードを再送信する"}
        </button>
        <button className="check-email-secondary" type="button" onClick={() => navigate("/register")}>
          メールアドレスを修正する
        </button>
        <small className="auth-help-text">メールが見つからない場合は、迷惑メールに分類されている可能性があります。迷惑メールフォルダも確認してください。</small>
      </form>
    </AuthPage>
  );
}

function LoginPage() {
  const { login } = useAppStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return toast.error("メールアドレスを入力してください。");
    if (!password) return toast.error("パスワードを入力してください。");
    setSubmitting(true);
    try {
      await login({ email, password });
      toast.success("ログインしました。");
      navigate("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ログインできませんでした。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage compact>
      <form className="auth-form auth-form-card" onSubmit={submit}>
        <h1>ログイン</h1>
        <label className="auth-field icon-field">
          <span>メールアドレス</span>
          <div>
            <Mail size={21} />
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" autoFocus />
          </div>
        </label>
        <PasswordField
          label="パスワード"
          value={password}
          onChange={setPassword}
          placeholder="パスワードを入力"
          visible={showPassword}
          onToggle={() => setShowPassword((value) => !value)}
          withIcon
        />
        <button className="wide-primary" type="submit" disabled={submitting}>{submitting ? "ログイン中..." : "ログイン"}</button>
        <div className="auth-divider"><span>または</span></div>
        <button className="outline-wide" type="button" onClick={() => navigate("/register")}>新規登録</button>
        <button className="auth-link" type="button" onClick={() => navigate("/forgot")}>パスワードを忘れた場合</button>
        <p className="auth-note"><ShieldCheck size={22} /> ログインすると、ルームの履歴が同期され、オンラインでの共有がもっと簡単になります。</p>
      </form>
    </AuthPage>
  );
}

function ForgotPasswordPage() {
  const { requestPasswordReset } = useAppStore();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return toast.error("メールアドレスを入力してください。");
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
      setSubmitted(true);
      toast.success("パスワード再設定メールを送信しました。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "再設定メールを送信できませんでした。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthPage compact>
      <form className="auth-form auth-form-card" onSubmit={submit}>
        <h1>パスワード再設定</h1>
        <p>登録済みのメールアドレスに、パスワード再設定用のリンクを送信します。</p>
        <label className="auth-field icon-field">
          <span>メールアドレス</span>
          <div>
            <Mail size={21} />
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" autoFocus />
          </div>
        </label>
        {submitted && (
          <div className="auth-message-box" role="status">
            <KeyRound size={24} />
            <div>
              <strong>メールを送信しました</strong>
              <p>届いたメールのリンクからパスワードを再設定してください。メールが見つからない場合は迷惑メールフォルダも確認してください。</p>
            </div>
          </div>
        )}
        <button className="wide-primary" type="submit" disabled={submitting}>{submitting ? "送信中..." : "再設定メールを送信"}</button>
        <button className="auth-link" type="button" onClick={() => navigate("/login")}>ログインに戻る</button>
      </form>
    </AuthPage>
  );
}

function TermsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="terms-title">
        <button className="close-button" onClick={onClose} aria-label="閉じる"><X size={26} /></button>
        <h2 id="terms-title">利用規約</h2>
        <div className="terms-body">
          <section>
            <h3>1. サービスの目的</h3>
            <p>SlideRoomは、複数人のPowerPointファイルを集め、順番を確認し、PPTXまたはPDFとして書き出すための開発中ツールです。</p>
          </section>
          <section>
            <h3>2. データの保存期間</h3>
            <p>ルーム内のスライド、アップロードファイル、出力履歴は作成から24時間以内に自動削除されます。必要なファイルは早めに書き出してください。</p>
          </section>
          <section>
            <h3>3. アップロード内容</h3>
            <p>第三者の権利を侵害するファイル、機密情報、個人情報を含むファイルのアップロードは避けてください。</p>
          </section>
          <section>
            <h3>4. 出力結果</h3>
            <p>PPTX/PDFの結合やプレビューは簡易実装です。特殊な図形、アニメーション、壊れたファイルは表示や出力が崩れる場合があります。</p>
          </section>
          <section>
            <h3>5. アカウント認証</h3>
            <p>登録、ログイン、パスワード再設定、メール認証は、本人確認と不正利用防止のために利用します。</p>
          </section>
        </div>
        <button className="wide-primary" type="button" onClick={onClose}>閉じる</button>
      </section>
    </div>
  );
}

function PrivacyPolicyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="terms-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
        <button className="close-button" onClick={onClose} aria-label="閉じる"><X size={26} /></button>
        <h2 id="privacy-title">プライバシーポリシー</h2>
        <p className="policy-updated">制定日: 2026年6月13日</p>
        <div className="terms-body">
          <section>
            <h3>1. 取得する情報</h3>
            <p>SlideRoomは、アカウント作成、ログイン、ルーム共有、ファイル結合のために、ユーザー名、メールアドレス、認証状態、作成したルーム情報、参加者名、アップロードされたPPTXファイル、生成したプレビューや出力履歴を取り扱います。</p>
          </section>
          <section>
            <h3>2. 利用目的</h3>
            <p>取得した情報は、本人確認、ログイン状態の維持、ルームの保存と共有、提出ファイルの表示、PPTX/PDF出力、問い合わせ対応、不正利用や障害の調査のために利用します。</p>
          </section>
          <section>
            <h3>3. 認証情報の扱い</h3>
            <p>メールアドレス、パスワード、メール認証コードなどの認証処理はSupabase Authを利用して管理します。SlideRoomの画面上でパスワードそのものを表示したり、アプリ独自の平文データとして保存したりしません。</p>
          </section>
          <section>
            <h3>4. ファイルとルームデータの保存期間</h3>
            <p>ルーム内のファイル、スライド、出力履歴などの作業データは、サーバー容量節約と不要データ削減のため、作成から24時間以内に削除される前提です。必要なPPTX/PDFは早めに書き出して保存してください。</p>
          </section>
          <section>
            <h3>5. 外部サービス</h3>
            <p>SlideRoomは、認証とデータ保存にSupabase、公開環境の配信にVercelを利用します。これらのサービス上で、アプリの提供に必要な範囲のデータが処理されます。</p>
          </section>
          <section>
            <h3>6. 第三者提供</h3>
            <p>法令に基づく場合、本人の同意がある場合、またはサービス提供に必要な外部サービスでの処理を除き、取得した情報を第三者に販売または提供しません。</p>
          </section>
          <section>
            <h3>7. アップロード時の注意</h3>
            <p>PPTXファイルには氏名、学籍番号、画像、メモ、非表示スライドなどが含まれる場合があります。不要な個人情報や機密情報を含むファイルはアップロードしないでください。</p>
          </section>
          <section>
            <h3>8. ポリシーの変更</h3>
            <p>機能追加、保存先の変更、法令対応などにより、本ポリシーを更新することがあります。重要な変更がある場合は、アプリ内または関連ドキュメントで案内します。</p>
          </section>
        </div>
        <button className="wide-primary" type="button" onClick={onClose}>閉じる</button>
      </section>
    </div>
  );
}

function AuthPage({ children, compact }: { children: ReactNode; compact?: boolean }) {
  return (
    <main className={cx("auth-page", compact && "is-compact")}>
      <section className="auth-shell">
        <BackButton />
        <CenteredBrand />
        {children}
      </section>
    </main>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  visible,
  onToggle,
  withIcon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  visible: boolean;
  onToggle: () => void;
  withIcon?: boolean;
}) {
  return (
    <label className={cx("auth-field", "password-field", withIcon && "icon-field")}>
      <span>{label}</span>
      <div>
        {withIcon && <Lock size={21} />}
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={visible ? "text" : "password"} />
        <button type="button" onClick={onToggle} aria-label={visible ? "パスワードを隠す" : "パスワードを表示"}>
          {visible ? <EyeOff size={21} /> : <Eye size={21} />}
        </button>
      </div>
    </label>
  );
}


function MyRoomsPage() {
  const { rooms, members, slides, currentUser, logout } = useAppStore();
  const myRoomIds = new Set(members.filter((member) => member.userId === currentUser.id).map((member) => member.roomId));
  const myRooms = rooms
    .filter((room) => room.hostUserId === currentUser.id || myRoomIds.has(room.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const recentRooms = myRooms.slice(0, 3);
  const firstThumbnailByRoomId = useMemo(() => {
    const map = new Map<string, string>();
    [...slides]
      .filter((slide) => slide.thumbnailUrl)
      .sort((a, b) => a.order - b.order)
      .forEach((slide) => {
        if (!map.has(slide.roomId) && slide.thumbnailUrl) {
          map.set(slide.roomId, slide.thumbnailUrl);
        }
      });
    return map;
  }, [slides]);

  function handleLogout() {
    logout();
    toast.success("ログアウトしました。");
    navigate("/");
  }

  return (
    <main className="myrooms-page">
      <section className="dashboard-shell">
        <AppTopNav active="rooms" onLogout={handleLogout} />
        <div className="myrooms-hero">
          <div>
            <h1>マイルーム</h1>
            <h2>こんにちは、{currentUser.name}さん</h2>
            <p>保存したルームを管理できます。</p>
          </div>
          <div className="hero-action-row">
            <button className="primary-action" onClick={() => navigate("/create")}>
              <PlusCircle size={24} /> 新しいルームを作る
            </button>
            <button className="secondary-action" onClick={() => navigate("/join")}>
              <KeyRound size={24} /> ルームに参加する
            </button>
          </div>
        </div>
        <section className="saved-rooms">
          <div className="section-title-row">
            <h2>最近使ったルーム</h2>
            {myRooms.length > 3 && (
              <button className="see-all-button" type="button">
                すべて見る <ArrowRight size={18} />
              </button>
            )}
          </div>
          <div className="room-card-list">
            {recentRooms.length > 0 ? (
              recentRooms.map((room, index) => (
                <MyRoomCard key={room.id} room={room} iconIndex={index} thumbnailUrl={firstThumbnailByRoomId.get(room.id)} />
              ))
            ) : (
              <EmptyRoomPanel compact />
            )}
          </div>
        </section>
        <MobileBottomNav active="rooms" />
      </section>
    </main>
  );
}

function AppTopNav({ active, onLogout }: { active: "rooms" | "account"; onLogout?: () => void }) {
  return (
    <header className="app-top-nav">
      <BrandMini />
      <nav className="main-tabs" aria-label="メインナビゲーション">
        <button className={cx(active === "rooms" && "is-active")} type="button" onClick={() => navigate("/")}>
          <House size={22} /> マイルーム
        </button>
        <button className={cx(active === "account" && "is-active")} type="button" onClick={() => navigate("/account")}>
          <User size={22} /> アカウント
        </button>
      </nav>
      <button className="top-icon-button" type="button" onClick={onLogout ?? (() => navigate("/account"))} aria-label={onLogout ? "ログアウト" : "アカウント設定"}>
        {onLogout ? <LogOut size={22} /> : <Settings size={22} />}
      </button>
    </header>
  );
}

function MobileBottomNav({ active }: { active: "rooms" | "account" }) {
  return (
    <nav className="mobile-bottom-nav" aria-label="モバイルナビゲーション">
      <button className={cx(active === "rooms" && "is-active")} type="button" onClick={() => navigate("/")}>
        <House size={25} /> <span>マイルーム</span>
      </button>
      <button className={cx(active === "account" && "is-active")} type="button" onClick={() => navigate("/account")}>
        <User size={25} /> <span>アカウント</span>
      </button>
    </nav>
  );
}

function EmptyRoomPanel({ compact }: { compact?: boolean }) {
  return (
    <section className={cx("empty-room-panel", compact && "is-compact")}>
      <FolderPlus size={58} />
      <strong>まだルームがありません</strong>
      <p>スライドを共有するルームを作成して、チームとコラボレーションを始めましょう。</p>
      <button className="outline-create-button" type="button" onClick={() => navigate("/create")}>
        <PlusCircle size={22} /> 新しいルームを作る
      </button>
    </section>
  );
}

function AccountPage() {
  const {
    currentUser,
    isEmailVerified,
    updateAccountName,
    changePassword,
    resendEmailVerification,
    logout,
  } = useAppStore();
  const [activeTab, setActiveTab] = useState<"settings" | "verification">("settings");
  const [name, setName] = useState(currentUser.name);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return toast.error("ユーザー名を入力してください。");
    setSavingName(true);
    try {
      await updateAccountName(name);
      toast.success("ユーザー名を更新しました。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ユーザー名を更新できませんでした。");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!newPassword) return toast.error("新しいパスワードを入力してください。");
    if (newPassword !== confirmPassword) return toast.error("確認用パスワードが一致しません。");
    setSavingPassword(true);
    try {
      await changePassword({ newPassword });
      setNewPassword("");
      setConfirmPassword("");
      toast.success("パスワードを更新しました。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "パスワードを更新できませんでした。");
    } finally {
      setSavingPassword(false);
    }
  }

  async function sendVerificationCode() {
    if (!currentUser.email) return toast.error("メールアドレスが登録されていません。");
    setSendingCode(true);
    try {
      await resendEmailVerification();
      setVerificationSent(true);
      toast.success("6桁のパスコードを送信しました。メールを確認してください。");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "パスコードを送信できませんでした。");
    } finally {
      setSendingCode(false);
    }
  }

  function handleLogout() {
    logout();
    toast.success("ログアウトしました。");
    navigate("/");
  }

  return (
    <main className="myrooms-page">
      <section className="dashboard-shell">
        <AppTopNav active="account" onLogout={handleLogout} />
      <section className="account-panel">
        <div className="account-head">
          <span className="user-avatar large">{currentUser.name.trim().charAt(0) || "U"}</span>
          <div>
            <h1>マイページ</h1>
            <p>アカウント情報、メール認証、パスワードを管理できます。</p>
          </div>
        </div>
        <div className="account-tabs" role="tablist" aria-label="アカウントメニュー">
          <button className={cx(activeTab === "settings" && "is-active")} type="button" role="tab" aria-selected={activeTab === "settings"} onClick={() => setActiveTab("settings")}>
            <Settings size={20} /> アカウント設定
          </button>
          <button className={cx(activeTab === "verification" && "is-active")} type="button" role="tab" aria-selected={activeTab === "verification"} onClick={() => setActiveTab("verification")}>
            <ShieldCheck size={20} /> ユーザー認証
          </button>
        </div>
        {activeTab === "settings" && (
          <>
            <form className="account-card" onSubmit={saveName}>
              <h2><User size={23} /> ユーザー名</h2>
              <label className="auth-field">
                <span>表示名</span>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="ユーザー名" />
              </label>
              <label className="auth-field">
                <span>メールアドレス</span>
                <input value={currentUser.email ?? ""} readOnly placeholder="未設定" />
              </label>
              <button className="wide-primary" type="submit" disabled={savingName}>{savingName ? "保存中..." : "ユーザー名を保存"}</button>
            </form>
            <form className="account-card" onSubmit={savePassword}>
              <h2><KeyRound size={23} /> パスワード変更</h2>
              <p className="account-card-help">ログイン中のアカウントに新しいパスワードを設定します。</p>
              <label className="auth-field">
                <span>新しいパスワード</span>
                <input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" placeholder="新しいパスワード" />
              </label>
              <label className="auth-field">
                <span>新しいパスワード確認</span>
                <input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" placeholder="もう一度入力" />
              </label>
              <button className="wide-primary" type="submit" disabled={savingPassword}>{savingPassword ? "更新中..." : "パスワードを更新"}</button>
            </form>
          </>
        )}
        {activeTab === "verification" && (
          <section className="account-card verification-card">
            <h2><ShieldCheck size={23} /> メール認証</h2>
            <p>メールに届いた6桁のパスコードを登録直後の認証画面で入力すると、アカウントの本人確認が完了します。</p>
            <div className={cx("verification-status", isEmailVerified && "is-verified")}>
              {isEmailVerified ? <Check size={22} /> : <Mail size={22} />}
              <div>
                <strong>{isEmailVerified ? "認証済み" : verificationSent ? "パスコード送信済み" : "未認証"}</strong>
                <span>{currentUser.email ?? "メールアドレス未設定"}</span>
              </div>
            </div>
            <button className="outline-wide" type="button" onClick={sendVerificationCode} disabled={sendingCode || isEmailVerified}>
              {isEmailVerified ? "認証済み" : sendingCode ? "送信中..." : verificationSent ? "パスコードを再送信" : "パスコードを送信"}
            </button>
            <small>メールが届かない場合は、迷惑メールに分類されている可能性があります。迷惑メールフォルダを確認するか、時間を置いて再送信してください。</small>
          </section>
        )}
        <div className="account-note">
          <ShieldCheck size={20} />
          <p>
            アカウント情報、アップロードファイル、ルームデータの扱いは
            <button type="button" onClick={() => setPrivacyOpen(true)}>プライバシーポリシー</button>
            に記載しています。
          </p>
        </div>
      </section>
      {privacyOpen && <PrivacyPolicyModal onClose={() => setPrivacyOpen(false)} />}
        <MobileBottomNav active="account" />
      </section>
    </main>
  );
}

function MyRoomCard({ room, iconIndex, thumbnailUrl }: { room: Room; iconIndex: number; thumbnailUrl?: string }) {
  const { members } = useAppStore();
  const memberCount = members.filter((member) => member.roomId === room.id).length || 1;
  return (
    <button className="myroom-card" type="button" onClick={() => navigate(`/room/${room.id}`)}>
      <RoomCover index={iconIndex} title={room.title} thumbnailUrl={thumbnailUrl} />
      <span className="myroom-body">
        <strong>{room.title}</strong>
        <span>{memberCount}人が参加中</span>
        <small><Clock size={17} /> 更新: {formatRelativeRoomUpdated(room.updatedAt)}</small>
      </span>
      <span className="room-card-menu">...</span>
      <span className="room-card-arrow"><ArrowRight size={22} /></span>
    </button>
  );
}

function RoomCover({ index, title, thumbnailUrl }: { index: number; title: string; thumbnailUrl?: string }) {
  const theme = ["earth", "chart", "plant"][index % 3];
  if (thumbnailUrl) {
    return (
      <span className="room-cover has-thumbnail">
        <img src={thumbnailUrl} alt="" />
      </span>
    );
  }
  return (
    <span className={cx("room-cover", `is-${theme}`)}>
      <b>{title}</b>
      <i />
    </span>
  );
}

function formatRelativeRoomUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "不明";
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "昨日" : `${days}日前`;
}


function DataExpiryNotice() {
  return (
    <p className="data-expiry-note">
      <Clock size={20} />
      ルーム内のスライド、アップロードファイル、出力履歴は作成から24時間以内に自動削除されます。
    </p>
  );
}

function CreateRoomPage() {
  const { createRoom } = useAppStore();
  const [title, setTitle] = useState("");
  const [accessMode, setAccessMode] = useState<"invite" | "authenticated">("invite");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("タイトルを入力してください。");
      return;
    }
    const room = createRoom({ title, className: "発表ルーム", accessMode });
    navigate(`/room/${room.id}`);
  }

  return (
    <SimplePage>
      <BackButton />
      <CenteredBrand />
      <form className="form-card" onSubmit={submit}>
        <h1>ルームを作る</h1>
        <DataExpiryNotice />
        <label className="field">
          <span>タイトル</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="タイトルを入力" autoFocus />
        </label>
        <div className="field">
          <span>公開設定</span>
          <div className="choice-list">
            <button className={cx("choice", accessMode === "invite" && "is-active")} type="button" onClick={() => setAccessMode("invite")}>
              <span className="radio-dot" /> URLまたは6ケタパスワードで参加
            </button>
            <button className={cx("choice", accessMode === "authenticated" && "is-active")} type="button" onClick={() => setAccessMode("authenticated")}>
              <span className="radio-dot" /> ログインしているユーザーだけ参加可能
            </button>
          </div>
        </div>
        <button className="wide-primary" type="submit">ルームを作成</button>
      </form>
    </SimplePage>
  );
}

function JoinRoomPage({ inviteCode }: { inviteCode?: string }) {
  const { joinRoom, syncFromServer } = useAppStore();
  const [name, setName] = useState("");
  const [code, setCode] = useState(inviteCode?.toUpperCase() ?? "");

  useEffect(() => {
    if (inviteCode) setCode(inviteCode.toUpperCase());
  }, [inviteCode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await syncFromServer();
    const result = joinRoom(code, name);
    if (result.error || !result.room) {
      toast.error(result.error ?? "参加できませんでした。");
      return;
    }
    navigate(`/room/${result.room.id}`);
  }

  return (
    <SimplePage>
      <BackButton />
      <CenteredBrand />
      <form className="form-card compact" onSubmit={submit}>
        <h1>ルームに参加</h1>
        <label className="input-with-icon">
          <User size={22} />
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="ユーザーネーム" />
        </label>
        <label className="input-with-icon">
          <Lock size={22} />
          <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="6ケタパスワード" />
        </label>
        <button className="wide-primary" type="submit">参加する</button>
      </form>
    </SimplePage>
  );
}

function RoomPage({ room }: { room: Room }) {
  const { files, slides, members } = useAppStore();
  const [exportOpen, setExportOpen] = useState(false);
  const shareUrl = createLocalInviteUrl(room.inviteCode);
  const accessMode = room.accessMode ?? "invite";
  const roomFiles = files.filter((file) => file.roomId === room.id && file.status !== "excluded");
  const roomSlides = slides.filter((slide) => slide.roomId === room.id && slide.isPlaced);
  const roomMembers = members.filter((member) => member.roomId === room.id);

  return (
    <SimplePage wide>
      <CenteredBrand />
      <section className="room-workspace">
        <BackButton inline />
        <h1>{room.title}</h1>
        <div className="share-grid">
          <CopyField label="参加URL" value={shareUrl} />
          <CopyField label="6ケタパスコード" value={room.inviteCode} />
        </div>
        <p className="access-mode-note">
          {accessMode === "authenticated"
            ? "このルームはログインしているユーザーだけ参加できます。"
            : "参加URLまたは6ケタパスコードを共有すると参加できます。"}
        </p>
        <DataExpiryNotice />
        <UploadBox roomId={room.id} />
        <MemberSection members={roomMembers} />
        <section className="file-section">
          <h2>現在のスライドファイル</h2>
          <div className="file-list-simple">
            {roomFiles.length === 0 ? (
              <EmptyInline text="まだファイルがありません。" />
            ) : (
              roomFiles.map((file) => <FileRow key={file.id} file={file} />)
            )}
          </div>
        </section>
        <div className="room-actions">
          <button className="secondary-action" onClick={() => navigate(`/room/${room.id}/order`)}>
            <ListOrdered size={24} /> スライド順番を表示
          </button>
          <button className="secondary-action" onClick={() => navigate(`/room/${room.id}/preview`)}>
            <Eye size={24} /> スライドをプレビュー
          </button>
          <button className="secondary-action" onClick={() => setExportOpen(true)}>
            <Upload size={24} /> エクスポート
          </button>
        </div>
        <p className="room-meta">合計スライド {roomSlides.length}枚　メンバー {roomMembers.length}人</p>
      </section>
      {exportOpen && <ExportModal room={room} onClose={() => setExportOpen(false)} />}
    </SimplePage>
  );
}

function MemberSection({ members }: { members: RoomMember[] }) {
  const sortedMembers = [...members].sort((a, b) => {
    const roleRank = (role: RoomMember["role"]) => (role === "host" ? 0 : 1);
    if (roleRank(a.role) !== roleRank(b.role)) return roleRank(a.role) - roleRank(b.role);
    return a.joinedAt.localeCompare(b.joinedAt);
  });

  return (
    <section className="member-section">
      <div className="section-title-row">
        <h2>参加者</h2>
        <span>{sortedMembers.length}人</span>
      </div>
      <div className="member-list-simple">
        {sortedMembers.length === 0 ? (
          <EmptyInline text="まだ参加者がいません。" />
        ) : (
          sortedMembers.map((member) => <MemberRow key={member.id} member={member} />)
        )}
      </div>
    </section>
  );
}

function MemberRow({ member }: { member: RoomMember }) {
  const isHost = member.role === "host";
  return (
    <div className="member-row-simple">
      <span className="member-avatar" aria-hidden="true">
        {member.name.trim().charAt(0) || "?"}
      </span>
      <div>
        <strong>{member.name}</strong>
        {member.isCurrentUser && <small>自分</small>}
      </div>
      <span className={cx("role-badge", isHost && "is-host")}>{isHost ? "host" : "member"}</span>
    </div>
  );
}

function OrderPage({ room }: { room: Room }) {
  const { slides, reorderSlides } = useAppStore();
  const { previews, isLoading } = useSlidePreviewMap(room.id);
  const placedSlides = useMemo(
    () => slides.filter((slide) => slide.roomId === room.id && slide.isPlaced).sort((a, b) => a.order - b.order),
    [slides, room.id],
  );
  const [orderedIds, setOrderedIds] = useState<string[]>(() => placedSlides.map((slide) => slide.id));

  useEffect(() => {
    setOrderedIds(placedSlides.map((slide) => slide.id));
  }, [placedSlides.map((slide) => slide.id).join("|")]);

  const orderedSlides = orderedIds.map((id) => placedSlides.find((slide) => slide.id === id)).filter((slide): slide is SlideItem => Boolean(slide));

  function move(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= orderedIds.length) return;
    const next = [...orderedIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setOrderedIds(next);
  }

  function saveOrder() {
    reorderSlides(room.id, orderedIds);
    toast.success("順番を保存しました。");
  }

  return (
    <SimplePage wide>
      <BrandLine />
      <section className="order-layout">
        <BackButton room={room} inline />
        <h1>スライド順番</h1>
        <p>上下ボタンでスライドの順番を並び替えられます。</p>
        <div className="order-list">
          {orderedSlides.map((slide, index) => (
            <div className="order-row" key={slide.id}>
              <span className="drag-dots">⋮⋮</span>
              <strong>{index + 1}</strong>
              <SlideThumb svg={previews[slide.id]} isLoading={isLoading} />
              <span className="order-title">{slide.title}</span>
              <div className="row-buttons">
                <button onClick={() => move(index, -1)} disabled={index === 0} aria-label="上へ"><ArrowUp size={21} /></button>
                <button onClick={() => move(index, 1)} disabled={index === orderedSlides.length - 1} aria-label="下へ"><ArrowDown size={21} /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="bottom-actions">
          <button className="secondary-action" onClick={() => navigate(`/room/${room.id}/preview`)}>
            <Eye size={24} /> プレビュー
          </button>
          <button className="primary-action" onClick={saveOrder}>
            <Save size={24} /> 順番を保存
          </button>
        </div>
      </section>
    </SimplePage>
  );
}

function PreviewPage({ room }: { room: Room }) {
  const { slides } = useAppStore();
  const [index, setIndex] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const { previews, isLoading } = useSlidePreviewMap(room.id);
  const roomSlides = useMemo(
    () => slides.filter((slide) => slide.roomId === room.id && slide.isPlaced).sort((a, b) => a.order - b.order),
    [slides, room.id],
  );
  const current = roomSlides[index] ?? roomSlides[0];
  const svg = current ? previews[current.id] : undefined;

  useEffect(() => {
    if (index >= roomSlides.length) setIndex(Math.max(0, roomSlides.length - 1));
  }, [index, roomSlides.length]);

  return (
    <SimplePage wide>
      <BrandLine />
      <section className="preview-layout">
        <BackButton room={room} inline />
        <h1>プレビュー</h1>
        <p className="preview-note">
          このプレビューは確認用の簡易表示です。出力後のPPTX/PDFでは、フォント、配置、画像、図形、アニメーションなどの見え方が異なる場合があります。
        </p>
        <div className="preview-card">
          {svg ? (
            <div className="real-slide" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : isLoading ? (
            <PreviewLoading />
          ) : roomSlides.length === 0 ? (
            <PreviewMessage title="スライドがありません" text="PPTXをアップロードすると、ここにプレビューが表示されます。" />
          ) : (
            <PreviewMessage title="プレビューを表示できませんでした" text="このスライドのプレビューを作成できませんでした。ファイル形式や内容を確認してください。" />
          )}
        </div>
        <div className="preview-controls">
          <button className="secondary-action" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>前へ</button>
          <strong>{roomSlides.length ? index + 1 : 0} / {roomSlides.length}</strong>
          <button className="secondary-action" disabled={index >= roomSlides.length - 1} onClick={() => setIndex((value) => Math.min(roomSlides.length - 1, value + 1))}>次へ</button>
        </div>
        <button className="wide-primary export-now" onClick={() => setExportOpen(true)}>エクスポート</button>
      </section>
      {exportOpen && <ExportModal room={room} onClose={() => setExportOpen(false)} />}
    </SimplePage>
  );
}

function ExportModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const { settings, createExport } = useAppStore();
  const [format, setFormat] = useState<ExportFormat>("pptx");
  const [fileName, setFileName] = useState(`${room.title}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<{ message: string; details: string[] } | null>(null);

  async function exportFile() {
    const exportSettings: ExportSettings = {
      format,
      fileName,
      includeCover: settings.includeCoverDefault,
      includePageNumber: settings.includePageNumberDefault,
      includeSectionDivider: true,
      includeMemberName: true,
    };

    setExporting(true);
    setExportError(null);
    try {
      const blob = format === "pdf"
        ? await mergeService.exportPdf(room.id, exportSettings)
        : await mergeService.exportPptx(room.id, exportSettings);
      const skippedSlides = (blob as Blob & { skippedSlides?: string[] }).skippedSlides ?? [];
      saveAs(blob, withExtension(fileName, format));
      createExport(room.id, exportSettings);
      if (skippedSlides.length) {
        toast.warning(`${skippedSlides.length}件のスライドをスキップして${format.toUpperCase()}を書き出しました。`);
      } else {
        toast.success(`${format.toUpperCase()}を書き出しました。`);
      }
      onClose();
    } catch (error) {
      const normalized = normalizeExportError(error);
      setExportError(normalized);
      createExport(room.id, exportSettings, "failed", [normalized.message, ...normalized.details].join("\n"));
      toast.error(normalized.message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="export-modal">
        <button className="close-button" onClick={onClose} aria-label="閉じる"><X size={26} /></button>
        <h2>エクスポート</h2>
        <div className="field">
          <span>出力形式</span>
          <div className="format-row">
            {(["pptx", "pdf"] as ExportFormat[]).map((value) => (
              <label key={value}>
                <input type="radio" checked={format === value} onChange={() => setFormat(value)} />
                {value.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>ファイル名</span>
          <input value={fileName} onChange={(event) => setFileName(event.target.value)} />
        </label>
        {exportError && (
          <div className="export-error-box" role="alert">
            <strong>{exportError.message}</strong>
            {exportError.details.length > 0 && (
              <ul>
                {exportError.details.map((detail) => <li key={detail}>{detail}</li>)}
              </ul>
            )}
          </div>
        )}
        <button className="wide-primary" onClick={exportFile} disabled={exporting}>
          {exporting ? "書き出し中..." : "書き出す"}
        </button>
      </section>
    </div>
  );
}

function normalizeExportError(error: unknown) {
  const fallback = "出力に失敗しました。";
  if (!(error instanceof Error)) return { message: fallback, details: [String(error)] };

  const maybeDetails = "details" in error && Array.isArray((error as { details?: unknown }).details)
    ? ((error as { details: unknown[] }).details).map(String).filter(Boolean)
    : [];
  return {
    message: error.message || fallback,
    details: maybeDetails,
  };
}

function UploadBox({ roomId }: { roomId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { addFile, isUploading } = useAppStore();

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    try {
      for (const file of Array.from(fileList)) {
        await addFile(roomId, file);
      }
      toast.success(`${fileList.length}件のファイルを追加しました。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "アップロードに失敗しました。");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section
      className="upload-box"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        handleFiles(event.dataTransfer.files);
      }}
    >
      <input ref={inputRef} type="file" multiple hidden onChange={(event) => handleFiles(event.target.files)} />
      <FileUp size={46} />
      <p>ファイルをドラッグ&ドロップしてください</p>
      <span>または</span>
      <button className="primary-action small" onClick={() => inputRef.current?.click()} disabled={isUploading}>
        ファイルを選択
      </button>
    </section>
  );
}

function PreviewLoading() {
  return (
    <div className="preview-status">
      <div className="preview-status-inner">
        <span className="preview-spinner" aria-hidden="true" />
        <strong>プレビューを読み込んでいます</strong>
        <p>スライドを画面用に変換しています。少しだけお待ちください。</p>
      </div>
    </div>
  );
}

function PreviewMessage({ title, text }: { title: string; text: string }) {
  return (
    <div className="preview-status">
      <div className="preview-status-inner">
        <FileText size={42} aria-hidden="true" />
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

function useSlidePreviewMap(roomId: string) {
  const { files, slides } = useAppStore();
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const roomFiles = useMemo(() => files.filter((file) => file.roomId === roomId && file.status !== "excluded"), [files, roomId]);
  const roomSlides = useMemo(() => slides.filter((slide) => slide.roomId === roomId && slide.isPlaced).sort((a, b) => a.order - b.order), [slides, roomId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const next: Record<string, string> = {};
      const slidesByFile = new Map<string, SlideItem[]>();
      roomSlides.forEach((slide) => {
        const file = roomFiles.find((candidate) => candidate.id === slide.fileId);
        if (file?.extension !== "pptx" || !file.storageKey) return;
        slidesByFile.set(file.id, [...(slidesByFile.get(file.id) ?? []), slide]);
      });

      if (slidesByFile.size === 0) {
        if (!cancelled) {
          setPreviews({});
          setIsLoading(false);
        }
        return;
      }

      await Promise.all(Array.from(slidesByFile.entries()).map(async ([fileId, fileSlides]) => {
        const file = roomFiles.find((candidate) => candidate.id === fileId);
        if (!file?.storageKey) return;
        const blob = await getBlob(file.storageKey);
        if (!blob) return;
        const svgs = await createPptxSlidePreviewSvgs(blob, fileSlides.map((slide) => slide.sourcePage));
        fileSlides.forEach((slide) => {
          const svg = svgs.get(slide.sourcePage);
          if (svg) next[slide.id] = svg;
        });
      }));

      if (!cancelled) {
        setPreviews(next);
        setIsLoading(false);
      }
    }

    setPreviews({});
    setIsLoading(true);
    load().catch((error) => {
      console.warn("PPTX preview failed", error);
      if (!cancelled) {
        setPreviews({});
        setIsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    roomId,
    roomFiles.map((file) => `${file.id}:${file.storageKey ?? ""}:${file.updatedAt}`).join("|"),
    roomSlides.map((slide) => `${slide.id}:${slide.fileId}:${slide.sourcePage}:${slide.order}`).join("|"),
  ]);

  return { previews, isLoading };
}

function DemoScreenshots() {
  return (
    <section className="demo-screenshots" aria-label="SlideRoomの使い方デモ">
      <div className="demo-head">
        <BrandMini />
        <span>使い方デモ</span>
      </div>
      <div className="demo-title-row">
        <div>
          <strong>ルーム作成から書き出しまでの流れ</strong>
          <p>新しい操作画面に合わせた使い方デモです。</p>
        </div>
        <span className="demo-menu">...</span>
      </div>
      <div className="demo-screen-grid">
        <DemoScreen
          step="1"
          title="タイトルと公開設定"
          caption="タイトルを入れて、リンク/パスコード参加かログイン限定を選びます。"
          variant="room"
        />
        <DemoScreen
          step="2"
          title="PPTXをアップロード"
          caption="ファイルをドラッグ&ドロップ、または選択して追加します。"
          variant="upload"
        />
        <DemoScreen
          step="3"
          title="順番を確認して出力"
          caption="プレビューで確認して、PPTXまたはPDFを書き出します。"
          variant="merge"
        />
      </div>
    </section>
  );
}

function DemoScreen({ step, title, caption, variant }: { step: string; title: string; caption: string; variant: "room" | "upload" | "merge" }) {
  return (
    <article className="demo-screen">
      <div className="demo-browser-bar">
        <span />
        <span />
        <span />
      </div>
      <div className="demo-screen-body">
        <div className="demo-step-pill">{step}</div>
        <strong>{title}</strong>
        <p>{caption}</p>
        {variant === "room" && (
          <div className="demo-form-shot">
            <label>
              <b>タイトル</b>
              <span />
            </label>
            <label>
              <b>公開設定</b>
              <div className="demo-choice-row">
                <span>リンク/パスコード</span>
                <span>ログイン限定</span>
              </div>
            </label>
            <button>ルームを作成</button>
          </div>
        )}
        {variant === "upload" && (
          <div className="demo-upload-shot">
            {[72, 88, 54].map((width, index) => (
              <div key={index}>
                <FileText size={18} />
                <span style={{ width: `${width}%` }} />
                <b>{index === 1 ? "確認中" : "提出済み"}</b>
              </div>
            ))}
          </div>
        )}
        {variant === "merge" && (
          <div className="demo-merge-shot">
            <div className="demo-slide-preview">
              <img src={previewHero} alt="" />
            </div>
            <div className="demo-thumbs">
              {[1, 2, 3, 4].map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function StepCard({ number, icon, title, text }: { number: string; icon: ReactNode; title: string; text: string }) {
  return (
    <article className="step-card">
      <b>{number}</b>
      <span>{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function FileRow({ file }: { file: SubmittedFile }) {
  return (
    <div className="file-row-simple">
      <span className="ppt-icon"><FileText size={22} /></span>
      <strong>{file.name}</strong>
      <small>{file.slideCount}枚 ・ {formatFileSize(file.size)}</small>
    </div>
  );
}

function SlideThumb({ svg, isLoading }: { svg?: string; isLoading?: boolean }) {
  return svg ? (
    <div className="slide-thumb-real" dangerouslySetInnerHTML={{ __html: svg }} />
  ) : isLoading ? (
    <div className="slide-thumb-loading" aria-label="サムネイルを読み込み中">
      <span className="thumb-spinner" aria-hidden="true" />
    </div>
  ) : (
    <div className="slide-thumb-empty" aria-label="サムネイルを表示できません">
      <FileText size={22} aria-hidden="true" />
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  async function copy() {
    await navigator.clipboard?.writeText(value);
    toast.success("コピーしました。");
  }

  return (
    <label className="copy-field">
      <span>{label}</span>
      <div>
        <input value={value} readOnly />
        <button onClick={copy} type="button"><Copy size={20} /> コピー</button>
      </div>
    </label>
  );
}

function SimpleHeader({ action }: { action?: ReactNode }) {
  return (
    <header className="simple-header">
      <BrandMini />
      {action}
    </header>
  );
}

function BrandMini() {
  return (
    <span className="brand-mini">
      <span className="brand-icon" />
      SlideRoom
    </span>
  );
}

function CenteredBrand() {
  return <div className="centered-brand"><BrandMini /></div>;
}

function BrandLine() {
  return <div className="brand-line"><BrandMini /></div>;
}

function BackButton({ room, inline }: { room?: Room; inline?: boolean }) {
  return (
    <button className={cx("back-button", inline && "is-inline")} onClick={() => navigate(room ? `/room/${room.id}` : "/")}>
      <ArrowLeft size={34} />
    </button>
  );
}

function SimplePage({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={cx("simple-page", wide && "wide")}>{children}</main>;
}

function EmptyInline({ text }: { text: string }) {
  return <div className="empty-inline">{text}</div>;
}

function NotFoundPage() {
  return (
    <SimplePage>
      <BackButton />
      <CenteredBrand />
      <section className="form-card compact">
        <h1>ルームが見つかりません</h1>
        <button className="wide-primary" onClick={() => navigate("/")}>ホームへ戻る</button>
      </section>
    </SimplePage>
  );
}

function withExtension(fileName: string, extension: string) {
  const clean = fileName.trim() || "SlideRoom";
  return clean.toLowerCase().endsWith(`.${extension}`) ? clean : `${clean}.${extension}`;
}

export default App;
