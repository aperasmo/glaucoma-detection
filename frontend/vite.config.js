import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

function getGitCommitHash() {
  // Preferred path: value passed in from the build environment (Docker ARG
  // / GitHub Actions). This is the reliable path for CI and production,
  // since .git and the git binary are not guaranteed to exist inside the
  // Docker build context at all - see deployment chat notes.
  if (process.env.VITE_COMMIT_HASH) {
    return process.env.VITE_COMMIT_HASH
  }
  // Fallback for plain local `npm run dev` outside Docker, where .git and
  // git both genuinely exist - preserves the original local-dev behaviour.
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(getGitCommitHash()),
  },
})