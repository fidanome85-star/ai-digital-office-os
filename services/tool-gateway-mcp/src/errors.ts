export type ToolGatewayErrorCode =
  | "NOT_FOUND"
  | "BINDING_DENIED"
  | "POLICY_BLOCKED"
  | "MCP_PROTOCOL_ERROR"
  | "MCP_UNREACHABLE"
  | "TIMEOUT";

export class ToolGatewayError extends Error {
  readonly code: ToolGatewayErrorCode;
  readonly retryable: boolean;

  constructor(code: ToolGatewayErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ToolGatewayError";
    this.code = code;
    this.retryable = retryable;
  }
}
