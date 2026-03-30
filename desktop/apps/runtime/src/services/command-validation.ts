const WINDOWS_DRIVE_PATH_PATTERN = /^["'`]?[a-zA-Z]:[\\/]/;
const RELATIVE_PATH_PATTERN = /^["'`]?(?:\.{1,2}[\\/]|[\\/])/;
const EXECUTABLE_TOKEN_PATTERN = /^[a-zA-Z0-9_.-]+(?:\.[a-zA-Z0-9_-]+)?$/;
const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u;

function readFirstToken(command: string): string {
  return command.trim().split(/\s+/, 1)[0] ?? "";
}

function looksLikeCommandToken(token: string): boolean {
  return (
    EXECUTABLE_TOKEN_PATTERN.test(token) ||
    WINDOWS_DRIVE_PATH_PATTERN.test(token) ||
    RELATIVE_PATH_PATTERN.test(token)
  );
}

export function validateShellCommandInput(command: string): string | null {
  const normalized = command.trim();
  if (!normalized) {
    return "Command cannot be empty.";
  }

  const firstToken = readFirstToken(normalized);
  if (looksLikeCommandToken(firstToken)) {
    return null;
  }

  if (HAN_CHARACTER_PATTERN.test(firstToken)) {
    return "Command input is not executable shell syntax. Pass a concrete command such as `Get-ChildItem E:\\`.";
  }

  return null;
}
