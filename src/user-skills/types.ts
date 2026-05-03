export type UserSkillSource = "user-created" | "skills.sh" | "github";

export type UserSkill = {
  id: string;
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  source: UserSkillSource;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type UserSkillStoreData = {
  version: 1;
  skills: UserSkill[];
};

export type CreateUserSkillInput = {
  name: string;
  description: string;
  markdown: string;
};

export type UpdateUserSkillInput = Partial<{
  name: string;
  description: string;
  markdown: string;
  enabled: boolean;
}>;

export type InstallUserSkillInput = {
  url: string;
};
