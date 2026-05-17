import { redactTerminalSecret } from "./statusViewModel.js";

export type OwnerPickerInput = {
	ownerScope: string;
	label?: string;
	description?: string;
	kind?: "web-user" | "root-recovery" | "local" | "legacy";
	isFallback?: boolean;
};

export type OwnerPickerDescriptor = {
	kind: "owner";
	title: string;
	items: OwnerPickerItemDescriptor[];
	selectedIndex: number;
	emptyMessage: string;
};

export type OwnerPickerItemDescriptor = {
	id: string;
	ownerScope: string;
	label: string;
	description?: string;
	current?: boolean;
	fallback?: boolean;
	disabled?: boolean;
	markers: string[];
};

export function buildOwnerPickerDescriptor(input: {
	owners: readonly OwnerPickerInput[];
	activeOwnerScope?: string;
	title?: string;
}): OwnerPickerDescriptor {
	const items = input.owners.map((owner) => ownerPickerItem(owner, owner.ownerScope === input.activeOwnerScope));
	const selectedIndex = Math.max(0, items.findIndex((item) => item.current));
	return {
		kind: "owner",
		title: input.title ?? "Select effective owner",
		items,
		selectedIndex,
		emptyMessage: "No owners are available.",
	};
}

function ownerPickerItem(owner: OwnerPickerInput, current: boolean): OwnerPickerItemDescriptor {
	const label = redactTerminalSecret(owner.label ?? owner.ownerScope);
	const markers = [current ? "current" : undefined, owner.isFallback ? "fallback" : undefined, owner.kind === "root-recovery" ? "root recovery" : undefined, owner.kind === "legacy" ? "legacy" : undefined]
		.filter((marker): marker is string => Boolean(marker));
	return {
		id: owner.ownerScope,
		ownerScope: owner.ownerScope,
		label,
		description: redactTerminalSecret([owner.ownerScope, owner.description].filter(Boolean).join(" | ")) || undefined,
		current,
		fallback: owner.isFallback,
		disabled: false,
		markers,
	};
}
