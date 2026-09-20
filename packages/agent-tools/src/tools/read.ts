import { createReadTool as createPiReadTool } from '@earendil-works/pi-agent-core'

/** 保留 Pi 的读取与分页实现，明确本地文件检查的工具选择。 */
export const createReadTool = () => {
  const tool = createPiReadTool()
  return {
    ...tool,
    description:
      'Primary tool for inspecting local file contents, including source code and configuration. Use this instead of bash cat, head, tail, or sed when reading known files. For multiple files, issue one read call per file; multiple read calls can be returned together. ' +
      tool.description,
  }
}
