/**
 * Opencode Plugin: TS Style Enforcer
 *
 * Intercepts write/edit/multiedit tool calls and checks content against
 * the shared rule engine. Throws on violations to hard-block the operation.
 *
 * Follows the same pattern as shadcn-enforcer.ts.
 */

import { runAllChecks, type CheckResult } from "@oisincoveney/style"

function isTargetFile(filePath: string): boolean {
  return (filePath.endsWith(".ts") || filePath.endsWith(".tsx"))
}

export const TsStyleEnforcerPlugin = async () => {
  return {
    "tool.execute.before": async (
      input: { tool?: string },
      output: { args?: Record<string, unknown> },
    ) => {
      const tool = input.tool
      if (!tool || !["write", "edit", "multiedit", "patch"].includes(tool)) return

      const args = output.args ?? {}
      const filePath = (args.filePath ?? args.file_path ?? "") as string

      if (!isTargetFile(filePath)) return

      let contentToCheck = ""

      if (tool === "write") {
        contentToCheck = (args.content as string) ?? ""
      } else if (tool === "edit") {
        contentToCheck = (args.newString as string) ?? (args.new_string as string) ?? ""
      } else if (tool === "multiedit") {
        const edits = (args.edits as Array<{ newString?: string; new_string?: string }>) ?? []
        contentToCheck = edits.map((e) => e.newString ?? e.new_string ?? "").join("\n")
      } else if (tool === "patch") {
        contentToCheck = (args.patch as string) ?? (args.content as string) ?? ""
      }

      if (!contentToCheck) return

      const result: CheckResult = runAllChecks(contentToCheck, filePath)

      if (result.violations.length === 0) {
        // Log warnings but don't block
        if (result.warnings.length > 0) {
          const warnList = result.warnings
            .map((w) => `  Rule ${w.rule}, line ${w.line}: ${w.message}`)
            .join("\n")
          console.warn(
            `⚠️  TS Style Enforcer: ${result.warnings.length} warning(s) in ${filePath}:\n${warnList}`,
          )
        }
        return
      }

      const violationList = result.violations
        .map((v) => `  Rule ${v.rule}${v.line > 0 ? `, line ${v.line}` : ""}: ${v.message}`)
        .join("\n")

      let msg = [
        `⛔ TS Style Enforcer: ${result.violations.length} violation(s) in ${filePath}:`,
        violationList,
      ]

      if (result.warnings.length > 0) {
        const warnList = result.warnings
          .map((w) => `  Rule ${w.rule}, line ${w.line}: ${w.message}`)
          .join("\n")
        msg.push(`\n⚠️  ${result.warnings.length} warning(s):`, warnList)
      }

      msg.push("\nFix violations before writing. Warnings are advisory.")

      throw new Error(msg.join("\n"))
    },
  }
}
