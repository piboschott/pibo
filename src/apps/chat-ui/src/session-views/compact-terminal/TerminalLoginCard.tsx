import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, CheckCircle, Copy, ExternalLink, Key, Loader2, Lock } from "lucide-react";
import { postAction } from "../../api";
import type { CompactTerminalRow } from "../../../../../session-ui/terminalRows.js";
import { isLoginMenuResult, unwrapActionResult, type LoginAuthMethod, type LoginProvider } from "./loginMenu";

type LoginStep =
	| { type: "select_provider" }
	| { type: "select_method"; provider: LoginProvider }
	| { type: "device_starting"; provider: LoginProvider }
	| { type: "device_flow"; provider: LoginProvider; url: string; state?: string; userCode?: string; instructions?: string }
	| { type: "api_key"; provider: LoginProvider }
	| { type: "success"; provider: LoginProvider; message: string }
	| { type: "error"; provider?: LoginProvider; message: string };

type LoginStartResult = {
	url?: string;
	state?: string;
	userCode?: string;
	instructions?: string;
	type?: string;
};

const METHOD_LABELS: Record<LoginAuthMethod, string> = {
	device_code: "Device code",
	api_key: "API key",
	oauth: "Browser OAuth",
};

export function TerminalLoginCard({
	row,
	piboSessionId,
}: {
	row: CompactTerminalRow;
	piboSessionId?: string | null;
}) {
	const data = isLoginMenuResult(row.output) ? row.output : undefined;
	const providers = useMemo(() => data?.providers ?? [], [data?.providers]);
	const [step, setStep] = useState<LoginStep>({ type: "select_provider" });
	const [busy, setBusy] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [code, setCode] = useState("");
	const [copied, setCopied] = useState<string | null>(null);

	const reset = useCallback(() => {
		setStep({ type: "select_provider" });
		setApiKey("");
		setCode("");
	}, []);

	const copyText = useCallback(async (value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(value);
			window.setTimeout(() => setCopied((current) => (current === value ? null : current)), 1600);
		} catch {
			/* ignore clipboard failures */
		}
	}, []);

	const startDeviceLogin = useCallback(async (provider: LoginProvider) => {
		if (!piboSessionId) {
			setStep({ type: "error", provider, message: "Select a chat session before starting login." });
			return;
		}
		setBusy(true);
		setStep({ type: "device_starting", provider });
		try {
			const result = unwrapActionResult(await postAction(piboSessionId, "login.start", { provider: provider.id })) as LoginStartResult;
			if (!result?.url) {
				setStep({ type: "error", provider, message: "No login URL returned." });
				return;
			}
			setStep({
				type: "device_flow",
				provider,
				url: result.url,
				state: result.state,
				userCode: result.userCode,
				instructions: result.instructions,
			});
		} catch (caught) {
			setStep({ type: "error", provider, message: caught instanceof Error ? caught.message : String(caught) });
		} finally {
			setBusy(false);
		}
	}, [piboSessionId]);

	const completeDeviceLogin = useCallback(async (provider: LoginProvider, state?: string, codeValue?: string) => {
		if (!piboSessionId) return;
		setBusy(true);
		try {
			await postAction(piboSessionId, "login.complete", {
				provider: provider.id,
				state: state ?? "",
				...(codeValue ? { code: codeValue } : {}),
			});
			setStep({ type: "success", provider, message: `${provider.name} login completed.` });
		} catch (caught) {
			setStep({ type: "error", provider, message: caught instanceof Error ? caught.message : String(caught) });
		} finally {
			setBusy(false);
		}
	}, [piboSessionId]);

	const saveApiKey = useCallback(async (provider: LoginProvider) => {
		if (!piboSessionId) return;
		const key = apiKey.trim();
		if (!key) return;
		setBusy(true);
		try {
			await postAction(piboSessionId, "login.apikey", { provider: provider.id, apiKey: key });
			setApiKey("");
			setStep({ type: "success", provider, message: `${provider.name} API key saved.` });
		} catch (caught) {
			setStep({ type: "error", provider, message: caught instanceof Error ? caught.message : String(caught) });
		} finally {
			setBusy(false);
		}
	}, [apiKey, piboSessionId]);

	if (!data) {
		return <LoginShell title="Login" tone="red">Unparseable login payload.</LoginShell>;
	}

	return (
		<LoginShell
			title={step.type === "select_provider" ? "Login" : providerTitle(step)}
			tone={step.type === "error" ? "red" : step.type === "success" ? "green" : "cyan"}
			action={step.type === "select_provider" ? undefined : <BackButton onClick={reset} disabled={busy} />}
		>
			{step.type === "select_provider" ? (
				<div className="grid gap-2">
					<div className="text-[11px] text-[#737373]">Choose a provider. Use <span className="text-[#38bdf8]">/login</span> anytime.</div>
					<div className="flex flex-wrap gap-1.5">
						{providers.map((provider) => (
							<button
								key={provider.id}
								type="button"
								onClick={() => setStep({ type: "select_method", provider })}
								className="inline-flex items-center gap-1 border border-[#3a3a3a] bg-transparent px-2 py-1 text-[11px] text-[#d4d4d4] hover:border-[#38bdf8] hover:text-[#38bdf8]"
							>
								<span>{provider.name}</span>
								{provider.configured ? <span className="text-[#22c55e]">●</span> : null}
							</button>
						))}
					</div>
				</div>
			) : step.type === "select_method" ? (
				<div className="grid gap-2">
					<div className="flex items-center gap-2 text-[11px]">
						<span className="text-[#737373]">Provider:</span>
						<span className="text-[#d4d4d4]">{step.provider.name}</span>
						{step.provider.configured ? <Badge tone="green">Configured</Badge> : <Badge tone="neutral">Not configured</Badge>}
					</div>
					<div className="flex flex-wrap gap-1.5">
						{step.provider.authMethods.map((method) => (
							<button
								key={method}
								type="button"
								onClick={() => method === "api_key" ? setStep({ type: "api_key", provider: step.provider }) : void startDeviceLogin(step.provider)}
								className="inline-flex items-center gap-1 border border-[#3a3a3a] bg-transparent px-2 py-1 text-[11px] text-[#d4d4d4] hover:border-[#38bdf8] hover:text-[#38bdf8]"
							>
								{method === "api_key" ? <Key size={11} /> : <Lock size={11} />}
								{METHOD_LABELS[method]}
							</button>
						))}
					</div>
				</div>
			) : step.type === "device_starting" ? (
				<div className="inline-flex items-center gap-2 text-[11px] text-[#38bdf8]"><Loader2 size={13} className="animate-spin" /> Starting device login...</div>
			) : step.type === "device_flow" ? (
				<div className="grid gap-2 text-[11px]">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-[#737373]">Open:</span>
						<a href={step.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#38bdf8] hover:underline">
							{compactUrl(step.url)} <ExternalLink size={11} />
						</a>
						<button type="button" onClick={() => void copyText(step.url)} className="inline-flex items-center gap-1 border border-[#3a3a3a] px-1.5 py-0.5 text-[#737373] hover:border-[#38bdf8] hover:text-[#38bdf8]">
							{copied === step.url ? <CheckCircle size={10} /> : <Copy size={10} />} {copied === step.url ? "Copied" : "Copy"}
						</button>
					</div>
					{step.userCode ? (
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-[#737373]">Code:</span>
							<button type="button" onClick={() => void copyText(step.userCode!)} className="border border-[#1f4960] px-2 py-0.5 font-semibold tracking-widest text-[#38bdf8] hover:border-[#38bdf8]">
								{step.userCode}
							</button>
							<span className="text-[#737373]">then</span>
							<button type="button" disabled={busy} onClick={() => void completeDeviceLogin(step.provider, step.state)} className="inline-flex items-center gap-1 border border-[#3a3a3a] px-2 py-0.5 text-[#d4d4d4] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50">
								{busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />} Complete
							</button>
						</div>
					) : (
						<div className="flex flex-wrap items-center gap-1.5">
							<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="authorization code" className="min-w-0 flex-1 border border-[#2a2a2a] bg-[#0b0b0b] px-2 py-1 text-[11px] text-[#d4d4d4] outline-none focus:border-[#38bdf8]" />
							<button type="button" disabled={busy || !code.trim()} onClick={() => void completeDeviceLogin(step.provider, step.state, code.trim())} className="inline-flex items-center gap-1 border border-[#3a3a3a] px-2 py-1 text-[#d4d4d4] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50">
								{busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />} Complete
							</button>
						</div>
					)}
					{step.instructions ? <div className="text-[#737373]">{step.instructions}</div> : null}
				</div>
			) : step.type === "api_key" ? (
				<div className="flex flex-wrap items-center gap-1.5 text-[11px]">
					<span className="text-[#737373]">API key:</span>
					<input
						type="password"
						value={apiKey}
						onChange={(event) => setApiKey(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void saveApiKey(step.provider);
						}}
						placeholder="sk-..."
						className="min-w-[12rem] flex-1 border border-[#2a2a2a] bg-[#0b0b0b] px-2 py-1 text-[11px] text-[#d4d4d4] outline-none focus:border-[#38bdf8]"
					/>
					<button type="button" disabled={busy || !apiKey.trim()} onClick={() => void saveApiKey(step.provider)} className="inline-flex items-center gap-1 border border-[#3a3a3a] px-2 py-1 text-[#d4d4d4] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50">
						{busy ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />} Save
					</button>
				</div>
			) : step.type === "success" ? (
				<div className="flex items-center gap-2 text-[11px] text-[#22c55e]"><CheckCircle size={13} /> {step.message}</div>
			) : (
				<div className="flex items-start gap-2 text-[11px] text-[#ef4444]"><AlertCircle size={13} className="mt-0.5 shrink-0" /> <span>{step.message}</span></div>
			)}
		</LoginShell>
	);
}

function LoginShell({
	title,
	tone,
	action,
	children,
}: {
	title: string;
	tone: "cyan" | "green" | "red";
	action?: ReactNode;
	children: ReactNode;
}) {
	const iconClass = tone === "red" ? "text-[#ef4444]" : tone === "green" ? "text-[#22c55e]" : "text-[#38bdf8]";
	return (
		<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]">
			<div className="mb-2 flex items-center gap-2">
				<Lock size={14} className={iconClass} />
				<span className="font-semibold text-[#d4d4d4]">{title}</span>
				{action ? <div className="ml-auto">{action}</div> : null}
			</div>
			{children}
		</div>
	);
}

function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
	return (
		<button type="button" disabled={disabled} onClick={onClick} className="inline-flex items-center gap-1 border border-[#3a3a3a] bg-transparent px-1.5 py-0.5 text-[11px] text-[#737373] hover:border-[#38bdf8] hover:text-[#38bdf8] disabled:opacity-50">
			<ArrowLeft size={10} /> Back
		</button>
	);
}

function Badge({ tone, children }: { tone: "green" | "neutral"; children: ReactNode }) {
	return <span className={`border px-1.5 py-0.5 text-[10px] ${tone === "green" ? "border-[#14532d] text-[#22c55e]" : "border-[#3a3a3a] text-[#737373]"}`}>{children}</span>;
}

function providerTitle(step: Exclude<LoginStep, { type: "select_provider" }>): string {
	return "provider" in step && step.provider ? step.provider.name : "Login";
}

function compactUrl(value: string): string {
	try {
		const url = new URL(value);
		return `${url.host}${url.pathname}`;
	} catch {
		return value.length > 42 ? `${value.slice(0, 39)}...` : value;
	}
}
