export type LoginAuthMethod = "device_code" | "api_key" | "oauth";

export type LoginProvider = {
	id: string;
	name: string;
	authMethods: LoginAuthMethod[];
	configured?: boolean;
};

export type LoginMenuResult = {
	action: "show_login_menu";
	providers: LoginProvider[];
};

export type ActionEnvelope = {
	type?: string;
	result?: unknown;
};

export function isLoginMenuResult(value: unknown): value is LoginMenuResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return record.action === "show_login_menu" && Array.isArray(record.providers);
}

export function unwrapActionResult(value: unknown): unknown {
	if (isActionEnvelope(value)) return value.result;
	return value;
}

function isActionEnvelope(value: unknown): value is ActionEnvelope {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value) && (value as ActionEnvelope).type === "execution_result";
}
