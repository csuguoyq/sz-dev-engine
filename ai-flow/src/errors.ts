export class StageError extends Error {
  readonly kind: "startup" | "finished";
  readonly exitCode: number | null;
  readonly command?: string;

  constructor(
    message: string,
    kind: "startup" | "finished",
    exitCode: number | null,
    command?: string,
  ) {
    super(message);
    this.name = "StageError";
    this.kind = kind;
    this.exitCode = exitCode;
    this.command = command;
  }
}

export function isStageError(err: unknown): err is StageError {
  return err instanceof StageError;
}
