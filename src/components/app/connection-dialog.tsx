import {
  CheckCircle2,
  Download,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  LogOut,
  Puzzle,
  RefreshCw,
  Server,
  ShieldCheck,
  UserRound,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { StLiveBridgeOperation, StOperation } from "../../hooks/use-st-connection";
import type {
  ConnectStSessionInput,
  StLiveBridgeMutationResult,
  StLiveBridgeStatus,
  StSession,
} from "../../lib/st-api";
import { runSafely } from "../../lib/async";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: StSession | null;
  rememberedOrigin: string;
  backendOnline: boolean;
  operation: StOperation;
  isRefreshing: boolean;
  error?: string | null;
  liveBridge: StLiveBridgeStatus | null;
  liveBridgeOperation: StLiveBridgeOperation;
  liveBridgeError?: string | null;
  onConnect: (input: ConnectStSessionInput) => Promise<StSession>;
  onRefresh: () => void | Promise<unknown>;
  onCheck: () => void | Promise<unknown>;
  onDisconnect: () => void | Promise<unknown>;
  onRetryBackend: () => void | Promise<unknown>;
  onCheckLiveBridge: () => Promise<StLiveBridgeStatus>;
  onInstallLiveBridge: () => Promise<StLiveBridgeMutationResult>;
  onUpdateLiveBridge: () => Promise<StLiveBridgeMutationResult>;
}

export function ConnectionDialog({
  open,
  onOpenChange,
  session,
  rememberedOrigin,
  backendOnline,
  operation,
  isRefreshing,
  error,
  liveBridge,
  liveBridgeOperation,
  liveBridgeError,
  onConnect,
  onRefresh,
  onCheck,
  onDisconnect,
  onRetryBackend,
  onCheckLiveBridge,
  onInstallLiveBridge,
  onUpdateLiveBridge,
}: ConnectionDialogProps) {
  const connected = session?.status === "connected";
  const sessionBusy = operation !== null || isRefreshing;
  const busy = sessionBusy || liveBridgeOperation === "install" || liveBridgeOperation === "update";

  useEffect(() => {
    if (
      !open
      || !connected
      || liveBridge
      || liveBridgeError
      || liveBridgeOperation !== null
    ) return;
    runSafely(onCheckLiveBridge);
  }, [connected, liveBridge, liveBridgeError, liveBridgeOperation, onCheckLiveBridge, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Server className="size-5" />
          </div>
          <DialogTitle>SillyTavern HTTP 连接</DialogTitle>
          <DialogDescription>
            Preset 读取与保存只依赖 HTTP 连接；可选 Live Bridge 仅供未来的真实 ST 实时调试使用。认证信息只用于当前服务端内存会话。
          </DialogDescription>
        </DialogHeader>

        {!backendOnline ? (
          <OfflineCard onRetry={onRetryBackend} />
        ) : (
          <div className="space-y-4">
            {session ? <SessionCard session={session} /> : null}
            {connected ? (
              <LiveBridgeCard
                status={liveBridge}
                operation={liveBridgeOperation}
                sessionBusy={sessionBusy}
                error={liveBridgeError}
                onCheck={onCheckLiveBridge}
                onInstall={onInstallLiveBridge}
                onUpdate={onUpdateLiveBridge}
              />
            ) : null}
            {!connected ? (
              <ConnectionForm
                key={session?.origin ?? rememberedOrigin}
                defaultOrigin={session?.origin ?? rememberedOrigin}
                busy={busy}
                onConnect={onConnect}
              />
            ) : (
              <details className="rounded-xl border border-border bg-surface px-4 py-3 text-xs">
                <summary className="cursor-pointer font-medium text-foreground">
                  更换地址或重新认证
                </summary>
                <div className="mt-4 border-t border-border pt-4">
                  <ConnectionForm
                    key={session.origin}
                    defaultOrigin={session.origin}
                    busy={busy}
                    onConnect={onConnect}
                    compact
                  />
                </div>
              </details>
            )}

            {error ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive-soft px-3 py-2 text-xs leading-5 text-destructive">
                {error}
              </div>
            ) : null}

            <div className="space-y-1 rounded-xl border border-primary/15 bg-primary-soft/35 p-3 text-[11px] leading-5 text-muted-foreground">
              <p>只在浏览器中记住 ST 地址。账号密码、HTTP Basic 密码、ST Cookie 与 CSRF 不会写入工程或 Web Storage；Node 重启后需重新连接。</p>
              <p>安全提示：连接非回环的 http:// ST 时，凭据与 ST Cookie 会在 Node 和 ST 之间明文传输，请优先使用 HTTPS。服务端目标策略为 any 时，能访问本工具的人可让 Node 连接任意目标，请仅在可信网络部署。</p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            完成
          </Button>
          {backendOnline ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => runSafely(session ? onCheck : onRefresh)}
            >
              {operation === "check" || isRefreshing ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {session ? "检查连接" : "刷新状态"}
            </Button>
          ) : null}
          {session ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => runSafely(onDisconnect)}
            >
              {operation === "disconnect" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <LogOut />
              )}
              断开
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LIVE_BRIDGE_REPOSITORY = "https://github.com/kalinote/SPB-live-bridge.git";

type LiveBridgeConfirmation = "install" | "update" | null;

function LiveBridgeCard({
  status,
  operation,
  sessionBusy,
  error,
  onCheck,
  onInstall,
  onUpdate,
}: {
  status: StLiveBridgeStatus | null;
  operation: StLiveBridgeOperation;
  sessionBusy: boolean;
  error?: string | null;
  onCheck: () => Promise<StLiveBridgeStatus>;
  onInstall: () => Promise<StLiveBridgeMutationResult>;
  onUpdate: () => Promise<StLiveBridgeMutationResult>;
}) {
  const [confirmation, setConfirmation] = useState<LiveBridgeConfirmation>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = sessionBusy || operation !== null;
  const state = status?.state;
  const repositoryUrl = status?.repositoryUrl ?? LIVE_BRIDGE_REPOSITORY;
  const primaryAction = state === "not-installed"
    ? "install"
    : state === "update-available" ? "update" : null;

  const runMutation = async (action: Exclude<LiveBridgeConfirmation, null>) => {
    setConfirmation(null);
    setNotice(null);
    const result = action === "install" ? await onInstall() : await onUpdate();
    setNotice(liveBridgeOutcomeLabel(result.outcome));
  };

  return (
    <section
      className="space-y-3 rounded-2xl border border-primary/15 bg-primary-soft/25 p-4"
      aria-labelledby="live-bridge-title"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-primary shadow-xs">
          <Puzzle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p id="live-bridge-title" className="text-sm font-medium">Live Bridge 实时调试扩展</p>
            <Badge>可选</Badge>
            <Badge
              variant={
                state === "installed"
                  ? "green"
                  : state === "update-available"
                    ? "amber"
                    : state === "source-mismatch" || state === "unavailable"
                      ? "red"
                      : "neutral"
              }
            >
              {liveBridgeStatusLabel(status, operation)}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {liveBridgeStatusDescription(status)}
          </p>
        </div>
      </div>

      <a
        href={repositoryUrl.replace(/\.git$/, "")}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 items-center gap-1 text-[11px] text-primary hover:underline"
      >
        <span className="truncate">固定来源：kalinote/SPB-live-bridge</span>
        <ExternalLink className="size-3 shrink-0" />
      </a>

      {status?.currentBranchName || status?.currentCommitHash ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <SessionFact label="分支" value={status.currentBranchName ?? "未报告"} />
          <SessionFact
            label="当前提交"
            value={status.currentCommitHash ? status.currentCommitHash.slice(0, 12) : "未报告"}
          />
        </div>
      ) : null}

      <div aria-live="polite" className="space-y-2">
        {error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2 text-xs leading-5 text-destructive">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-success/20 bg-success-soft px-3 py-2 text-xs leading-5 text-success">
            {notice}
          </div>
        ) : null}
        {status?.requiresStReload ? (
          <div className="rounded-lg border border-warning/20 bg-warning-soft px-3 py-2 text-xs leading-5 text-warning">
            请刷新或重新打开 SillyTavern 页面以加载扩展文件；无需重启 ST 服务。
          </div>
        ) : null}
      </div>

      {confirmation ? (
        <div className="rounded-xl border border-warning/25 bg-warning-soft/55 p-3">
          <p className="text-xs font-medium">
            {confirmation === "install" ? "确认安装 Live Bridge？" : "确认更新 Live Bridge？"}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {confirmation === "install"
              ? "SillyTavern 将从上方固定仓库安装到当前 ST 用户；不会影响其他用户，也不会修改任何 preset。"
              : "SillyTavern 将从已验证的固定来源更新当前用户的扩展文件；不会覆盖来源不匹配的同名扩展。"}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmation(null)}>
              取消
            </Button>
            <Button size="sm" disabled={busy} onClick={() => runSafely(() => runMutation(confirmation))}>
              {busy ? <LoaderCircle className="animate-spin" /> : confirmation === "install" ? <Download /> : <RefreshCw />}
              {confirmation === "install" ? "确认安装" : "确认更新"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setNotice(null);
              runSafely(onCheck);
            }}
          >
            {operation === "check" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {status ? "重新检查" : "检查扩展"}
          </Button>
          {primaryAction ? (
            <Button size="sm" disabled={busy} onClick={() => setConfirmation(primaryAction)}>
              {primaryAction === "install" ? <Download /> : <RefreshCw />}
              {primaryAction === "install" ? "安装到当前 ST 用户" : "更新 Live Bridge"}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function liveBridgeStatusLabel(status: StLiveBridgeStatus | null, operation: StLiveBridgeOperation) {
  if (operation === "check") return "正在检查";
  if (operation === "install") return "正在安装";
  if (operation === "update") return "正在更新";
  if (!status) return "尚未检查";
  if (status.state === "not-installed") return "未安装";
  if (status.state === "installed") return "已安装";
  if (status.state === "update-available") return "可更新";
  if (status.state === "source-mismatch") return "来源不匹配";
  return "不可用";
}

function liveBridgeStatusDescription(status: StLiveBridgeStatus | null) {
  if (!status) return "只在使用真实 ST 页面预览、Prompt 捕获等实时调试功能时需要安装；Preset 读取、保存与工程编辑不受影响。";
  if (status.state === "not-installed") return "当前用户尚未安装。基础 Preset 读取、保存与工程编辑无需此扩展。";
  if (status.state === "installed") return "基础扩展已就绪；当前版本只提供安装与更新管理，实时桥接能力将在后续版本启用。";
  if (status.state === "update-available") return "固定来源中存在更新，可由 SillyTavern 直接拉取，无需填写 Git 地址或移动文件。";
  if (status.state === "source-mismatch") return "检测到同名扩展，但来源或分支不是受信任发布目标。为避免意外覆盖，Studio 不会安装或更新它。";
  return "当前 SillyTavern 无法使用扩展管理接口；基础 Preset 功能仍可正常使用。";
}

function liveBridgeOutcomeLabel(outcome: StLiveBridgeMutationResult["outcome"]) {
  if (outcome === "installed") return "Live Bridge 已安装。";
  if (outcome === "already-installed") return "Live Bridge 已安装，无需重复操作。";
  if (outcome === "updated") return "Live Bridge 已更新。";
  return "Live Bridge 已是最新提交。";
}

function ConnectionForm({
  defaultOrigin,
  busy,
  compact = false,
  onConnect,
}: {
  defaultOrigin: string;
  busy: boolean;
  compact?: boolean;
  onConnect: (input: ConnectStSessionInput) => Promise<StSession>;
}) {
  const originRef = useRef<HTMLInputElement>(null);
  const basicUsernameRef = useRef<HTMLInputElement>(null);
  const basicPasswordRef = useRef<HTMLInputElement>(null);
  const accountHandleRef = useRef<HTMLInputElement>(null);
  const accountPasswordRef = useRef<HTMLInputElement>(null);
  const [useBasicAuth, setUseBasicAuth] = useState(false);
  const [useAccountAuth, setUseAccountAuth] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);
    try {
      const origin = normalizeOrigin(originRef.current?.value ?? "");
      const input: ConnectStSessionInput = { origin };
      if (useBasicAuth) {
        input.basicAuth = requireCredentials(
          basicUsernameRef.current?.value,
          basicPasswordRef.current?.value,
          "HTTP Basic",
        );
      }
      if (useAccountAuth) {
        const handle = accountHandleRef.current?.value.trim() ?? "";
        if (!handle) throw new Error("请填写 SillyTavern 账号 handle。");
        input.accountAuth = {
          handle,
          password: accountPasswordRef.current?.value ?? "",
        };
      }
      await onConnect(input);
    } catch (caught) {
      setValidationError(caught instanceof Error ? caught.message : "无法连接 SillyTavern。");
    } finally {
      if (basicPasswordRef.current) basicPasswordRef.current.value = "";
      if (accountPasswordRef.current) accountPasswordRef.current.value = "";
    }
  };

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
          SillyTavern 地址
        </span>
        <Input
          ref={originRef}
          name="st-origin"
          type="url"
          inputMode="url"
          autoComplete="url"
          defaultValue={defaultOrigin}
          placeholder="例如 http://192.168.1.10:8000"
          disabled={busy}
          required
        />
      </label>

      <AuthSection
        icon={ShieldCheck}
        title="HTTP Basic 认证"
        description="ST 自身或其反向代理启用 Basic Auth 时开启。"
        checked={useBasicAuth}
        onCheckedChange={setUseBasicAuth}
      >
        <CredentialFields
          usernameRef={basicUsernameRef}
          passwordRef={basicPasswordRef}
          usernameName="basic-username"
          passwordName="basic-password"
          usernameLabel="Basic 用户名"
          autoComplete="current-password"
          disabled={busy}
        />
      </AuthSection>

      <AuthSection
        icon={UserRound}
        title="SillyTavern 账号"
        description="ST 开启多用户登录时填写 handle 与密码。"
        checked={useAccountAuth}
        onCheckedChange={setUseAccountAuth}
      >
        <CredentialFields
          usernameRef={accountHandleRef}
          passwordRef={accountPasswordRef}
          usernameName="st-handle"
          passwordName="st-password"
          usernameLabel="账号 handle"
          autoComplete="current-password"
          passwordRequired={false}
          disabled={busy}
        />
      </AuthSection>

      {validationError ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2 text-xs text-destructive">
          {validationError}
        </div>
      ) : null}

      <Button className={compact ? "w-full" : "w-full sm:w-auto"} disabled={busy} type="submit">
        {busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
        {busy ? "正在连接…" : "测试并连接"}
      </Button>
    </form>
  );
}

function AuthSection({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/25 p-3">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-primary shadow-xs">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium">{title}</p>
          <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{description}</p>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={`启用${title}`} />
      </div>
      {checked ? <div className="mt-3 border-t border-border pt-3">{children}</div> : null}
    </div>
  );
}

function CredentialFields({
  usernameRef,
  passwordRef,
  usernameName,
  passwordName,
  usernameLabel,
  autoComplete,
  passwordRequired = true,
  disabled,
}: {
  usernameRef: React.RefObject<HTMLInputElement | null>;
  passwordRef: React.RefObject<HTMLInputElement | null>;
  usernameName: string;
  passwordName: string;
  usernameLabel: string;
  autoComplete: string;
  passwordRequired?: boolean;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label>
        <span className="mb-1.5 block text-[11px] text-muted-foreground">{usernameLabel}</span>
        <Input ref={usernameRef} name={usernameName} autoComplete="username" disabled={disabled} required />
      </label>
      <label>
        <span className="mb-1.5 block text-[11px] text-muted-foreground">
          密码{passwordRequired ? "" : "（可选）"}
        </span>
        <Input
          ref={passwordRef}
          name={passwordName}
          type="password"
          autoComplete={autoComplete}
          disabled={disabled}
          required={passwordRequired}
        />
      </label>
    </div>
  );
}

function SessionCard({ session }: { session: StSession }) {
  const connected = session.status === "connected";
  return (
    <div
      className={
        connected
          ? "space-y-4 rounded-2xl border border-success/20 bg-success-soft/55 p-4"
          : "space-y-4 rounded-2xl border border-warning/25 bg-warning-soft/55 p-4"
      }
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface shadow-xs">
          {connected ? (
            <CheckCircle2 className="size-5 text-success" />
          ) : (
            <WifiOff className="size-5 text-warning" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{sessionStatusLabel(session.status)}</p>
            {session.version ? <Badge variant={connected ? "green" : "amber"}>ST {session.version}</Badge> : null}
            {session.branch ? <Badge>{session.branch}</Badge> : null}
          </div>
          <a
            href={session.origin}
            target="_blank"
            rel="noreferrer"
            className="mt-1 flex min-w-0 items-center gap-1 text-xs text-primary hover:underline"
          >
            <span className="truncate">{session.origin}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <SessionFact label="ST 用户" value={session.userHandle ?? "未报告 / 无需登录"} />
        <SessionFact label="兼容性" value={compatibilityLabel(session.compatibility)} />
        <SessionFact label="连接目标策略" value={targetPolicyLabel(session.targetPolicy)} />
        <SessionFact label="最近检查" value={formatDate(session.lastCheckedAt)} />
      </div>
    </div>
  );
}

function SessionFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/80 bg-surface/85 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-xs font-medium" title={value}>{value}</p>
    </div>
  );
}

function OfflineCard({ onRetry }: { onRetry: () => void | Promise<unknown> }) {
  return (
    <div className="rounded-2xl border border-destructive/20 bg-destructive-soft/55 p-4">
      <div className="flex items-start gap-3">
        <WifiOff className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div>
          <p className="text-sm font-medium">工程服务离线</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            ST HTTP 会话由 Node 管理。请先恢复工程服务并检查 /api 代理。
          </p>
        </div>
      </div>
      <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => runSafely(onRetry)}>
        <RefreshCw />
        重试工程服务
      </Button>
    </div>
  );
}

function normalizeOrigin(value: string) {
  const raw = value.trim();
  if (!raw) throw new Error("请输入 SillyTavern 地址。");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SillyTavern 地址格式无效。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SillyTavern 地址必须使用 http:// 或 https://。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("地址不能包含账号、密码、查询参数或片段。");
  }
  url.pathname = "/";
  return url.origin;
}

function requireCredentials(
  username: string | undefined,
  password: string | undefined,
  label: string,
) {
  const normalizedUsername = username?.trim() ?? "";
  if (!normalizedUsername || !password) {
    throw new Error(`请完整填写${label}用户名和密码。`);
  }
  return { username: normalizedUsername, password };
}

function sessionStatusLabel(status: StSession["status"]) {
  if (status === "connected") return "连接正常";
  if (status === "unreachable") return "SillyTavern 暂时不可达";
  if (status === "expired") return "登录会话已过期";
  return "当前 SillyTavern 版本不受支持";
}

function compatibilityLabel(compatibility: StSession["compatibility"]) {
  return compatibility === "supported" ? "已验证兼容" : "尚未验证兼容";
}

function targetPolicyLabel(policy: StSession["targetPolicy"]) {
  if (policy === "allowlist") return "仅回环与白名单";
  if (policy === "private") return "仅私有网络";
  return "任意 HTTP(S) 目标";
}

function formatDate(value: string | null) {
  if (!value) return "尚未检查";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
