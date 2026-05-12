/**
 * Public exports for hook dispatchers and consumers that need project
 * detection or configuration types.
 */

export type { DevConfig, Language, PackageManager, Target, WorkflowFramework } from './config.js'
export { detectProject } from './detect.js'
export type { Detected } from './detect.js'
export { RULE_SKILLS, SUPERPOWER_SKILLS, ALL_SKILLS, skillsForVariant } from './skills.js'
export type { Skill, RuleSkill, SuperpowerSkill, ProjectVariant } from './skills.js'
