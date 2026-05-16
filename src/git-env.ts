export const LOCAL_GIT_ENV_KEYS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_QUARANTINE_PATH',
  'GIT_WORK_TREE',
] as const

export function clearLocalGitEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of LOCAL_GIT_ENV_KEYS) {
    delete env[key]
  }
}

export function gitSubprocessEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra }
  clearLocalGitEnv(env)
  return env
}
