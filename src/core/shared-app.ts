export const SHARED_APP_SCOPE = "shared:app";
export const SHARED_PRINCIPAL_ID = "shared:app";

export function compatibleOwnerScopes(ownerScope: string | null | undefined): string[] {
	if (!ownerScope || ownerScope === SHARED_APP_SCOPE) return [SHARED_APP_SCOPE];
	return [ownerScope, SHARED_APP_SCOPE];
}

export function compatiblePrincipalIds(principalId: string | null | undefined): string[] {
	if (!principalId || principalId === SHARED_PRINCIPAL_ID) return [SHARED_PRINCIPAL_ID];
	return [principalId, SHARED_PRINCIPAL_ID];
}

export function isCompatibleOwnerScope(actual: string | null | undefined, expected: string | null | undefined): boolean {
	if (!expected) return true;
	return compatibleOwnerScopes(expected).includes(actual ?? SHARED_APP_SCOPE);
}
