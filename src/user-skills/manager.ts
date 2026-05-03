import type { CreateUserSkillInput, UpdateUserSkillInput, UserSkill } from "./types.js";
import {
	createUserSkill,
	deleteUserSkill,
	findUserSkill,
	listUserSkills,
	readSkillMarkdown,
	setUserSkillEnabled,
	updateUserSkill,
} from "./store.js";
import { installSkillFromUrl } from "./installer.js";

export class UserSkillManager {
	constructor(private readonly cwd: string) {}

	create(input: CreateUserSkillInput): UserSkill {
		return createUserSkill(input, this.cwd);
	}

	update(id: string, input: UpdateUserSkillInput): UserSkill {
		return updateUserSkill(id, input, this.cwd);
	}

	remove(id: string): UserSkill | undefined {
		return deleteUserSkill(id, this.cwd);
	}

	setEnabled(id: string, enabled: boolean): UserSkill {
		return setUserSkillEnabled(id, enabled, this.cwd);
	}

	async installFromUrl(url: string): Promise<UserSkill> {
		return installSkillFromUrl(url, this.cwd);
	}

	getSkillMarkdown(id: string): string {
		const skill = findUserSkill(id, this.cwd);
		if (!skill) return "";
		return readSkillMarkdown(skill, this.cwd);
	}

	list(): UserSkill[] {
		return listUserSkills(this.cwd);
	}

	get(id: string): UserSkill | undefined {
		return findUserSkill(id, this.cwd);
	}
}
