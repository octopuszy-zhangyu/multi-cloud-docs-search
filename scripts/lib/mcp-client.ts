/**
 * MCP JSON-RPC 客户端
 *
 * 独立启动 MCP Server 进程，通过 stdin/stdout 通信。
 * 避免与 Claude 已加载的 MCP Server 冲突。
 */

import { spawn, type ChildProcess } from "child_process";
import * as path from "path";

const SERVER_SCRIPT = path.resolve(import.meta.dirname, "../../src/stdio.ts");

interface McpRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content: { type: string; text: string }[];
  };
  error?: {
    code: number;
    message: string;
  };
}

export class McpClient {
  private process: ChildProcess | null = null;
  private requestId = 1;
  private pending = new Map<number, { resolve: (v: McpResponse) => void; reject: (e: Error) => void }>();
  private buffer = "";

  /**
   * 启动 MCP Server 进程
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn("npx", ["tsx", SERVER_SCRIPT], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      let started = false;

      this.process.stdout!.on("data", (data: Buffer) => {
        this.buffer += data.toString();

        // 尝试解析完整的 JSON-RPC 响应
        let newlineIdx: number;
        while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.substring(0, newlineIdx).trim();
          this.buffer = this.buffer.substring(newlineIdx + 1);

          if (!line) continue;

          try {
            const response = JSON.parse(line) as McpResponse;
            const pending = this.pending.get(response.id);
            if (pending) {
              this.pending.delete(response.id);
              pending.resolve(response);
            }
          } catch {
            // 忽略非 JSON 输出（如启动日志）
            if (!started && line.includes("MCP Server")) {
              started = true;
              resolve();
            }
          }
        }
      });

      this.process.stderr!.on("data", (data: Buffer) => {
        // stderr 输出不处理，只是日志
      });

      this.process.on("error", (err) => {
        if (!started) {
          reject(err);
        }
      });

      this.process.on("exit", (code) => {
        if (!started) {
          reject(new Error(`Server exited with code ${code}`));
        }
        // 清理所有 pending 请求
        for (const [, pending] of this.pending) {
          pending.reject(new Error("Server process exited"));
        }
        this.pending.clear();
      });

      // 超时处理
      setTimeout(() => {
        if (!started) {
          started = true;
          resolve(); // 即使没有收到启动消息也继续
        }
      }, 3000);
    });
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpResponse> {
    return new Promise((resolve, reject) => {
      const id = this.requestId++;
      const request: McpRequest = {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      };

      this.pending.set(id, { resolve, reject });

      // 超时
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${name}(${JSON.stringify(args)})`));
      }, 60000);

      // 包装 resolve 以清除超时
      const originalResolve = resolve;
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          originalResolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
  }

  /**
   * 停止 MCP Server 进程
   */
  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  /**
   * 验证 MCP 响应格式
   */
  validateResponse(response: McpResponse): { valid: boolean; error?: string } {
    if (!response) {
      return { valid: false, error: "响应为空" };
    }

    if (response.error) {
      return { valid: false, error: `MCP 错误: ${response.error.message}` };
    }

    if (!response.result) {
      return { valid: false, error: "响应缺少 result 字段" };
    }

    if (!response.result.content || !Array.isArray(response.result.content)) {
      return { valid: false, error: "响应缺少 content 数组" };
    }

    if (response.result.content.length === 0) {
      return { valid: false, error: "content 数组为空" };
    }

    const firstContent = response.result.content[0];
    if (firstContent.type !== "text") {
      return { valid: false, error: `content 类型不是 text: ${firstContent.type}` };
    }

    if (!firstContent.text) {
      return { valid: false, error: "content text 为空" };
    }

    return { valid: true };
  }

  /**
   * 解析 MCP 响应中的 JSON 数据
   */
  parseResult<T>(response: McpResponse): T {
    const text = response.result!.content[0].text;
    return JSON.parse(text) as T;
  }
}
