export type CliParseErrorCode =
  | 'PROFILE_REQUIRED'
  | 'COMMAND_REQUIRED'
  | 'UNKNOWN_COMMAND'
  | 'ARGUMENT_ERROR';

export type ParsedCliCommand =
  | {
    readonly name: 'catalog';
    readonly json: boolean;
  }
  | {
    readonly name: 'help';
  }
  | {
    readonly name: 'profile-status';
  }
  | {
    readonly name: 'session';
    readonly action: 'show' | 'clear-customer';
  }
  | {
    readonly name: 'session';
    readonly action: 'select-customer';
    readonly customer_id: string;
  }
  | {
    readonly name: 'cap';
    readonly capability_id: string;
    readonly args: unknown;
    /** Present only for the explicit import.file.preview file transport. */
    readonly file_path?: string;
  };

export interface ParsedCliSuccess {
  readonly ok: true;
  readonly profile: string;
  readonly command: ParsedCliCommand;
}

export interface ParsedCliFailure {
  readonly ok: false;
  /** Present once the caller supplied an explicit --profile value. */
  readonly profile?: string;
  readonly code: CliParseErrorCode;
}

export type ParsedCliArgs = ParsedCliSuccess | ParsedCliFailure;

function argumentError(profile: string): ParsedCliFailure {
  return { ok: false, profile, code: 'ARGUMENT_ERROR' };
}

function parseCapabilityCommand(profile: string, argv: readonly string[]): ParsedCliArgs {
  const capability_id = argv[0];
  if (!capability_id || capability_id === '--args' || capability_id === '--file') return argumentError(profile);

  const optionArgs = argv.slice(1);
  if (capability_id === 'import.file.preview') {
    const file_path = optionArgs[1];
    if (optionArgs.length !== 2 || optionArgs[0] !== '--file' || file_path === undefined || file_path.trim().length === 0) {
      return argumentError(profile);
    }
    return {
      ok: true,
      profile,
      command: { name: 'cap', capability_id, args: undefined, file_path },
    };
  }

  if (optionArgs.length === 0) {
    return {
      ok: true,
      profile,
      command: { name: 'cap', capability_id, args: undefined },
    };
  }

  if (optionArgs.length !== 2 || optionArgs[0] !== '--args' || optionArgs[1] === undefined) {
    return argumentError(profile);
  }

  try {
    // Deliberately parse only JSON syntax.  Field names and values are not
    // normalized, aliased, hydrated, or validated in C1.
    const args: unknown = JSON.parse(optionArgs[1]);
    return {
      ok: true,
      profile,
      command: { name: 'cap', capability_id, args },
    };
  } catch {
    return argumentError(profile);
  }
}

function parseSessionCommand(profile: string, argv: readonly string[]): ParsedCliArgs {
  const action = argv[0];
  switch (action) {
    case 'show':
      return argv.length === 1
        ? { ok: true, profile, command: { name: 'session', action: 'show' } }
        : argumentError(profile);
    case 'clear-customer':
      return argv.length === 1
        ? { ok: true, profile, command: { name: 'session', action: 'clear-customer' } }
        : argumentError(profile);
    case 'select-customer': {
      const customer_id = argv[2];
      if (argv.length !== 3 || argv[1] !== '--id' || customer_id === undefined || customer_id.trim().length === 0) {
        return argumentError(profile);
      }
      return { ok: true, profile, command: { name: 'session', action: 'select-customer', customer_id } };
    }
    default:
      return argumentError(profile);
  }
}

/**
 * Parse the intentionally small C1/C2 CLI grammar. Profile-name validation is
 * owned by main.ts so it remains on the existing C0 security gate.
 */
export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  if (argv[0] !== '--profile' || argv[1] === undefined) {
    return { ok: false, code: 'PROFILE_REQUIRED' };
  }

  const profile = argv[1];
  const command = argv[2];
  if (command === undefined) return { ok: false, profile, code: 'COMMAND_REQUIRED' };

  const commandArgs = argv.slice(3);
  switch (command) {
    case 'catalog':
      if (commandArgs.length === 0) {
        return { ok: true, profile, command: { name: 'catalog', json: false } };
      }
      if (commandArgs.length === 1 && commandArgs[0] === '--json') {
        return { ok: true, profile, command: { name: 'catalog', json: true } };
      }
      return argumentError(profile);
    case 'help':
      return commandArgs.length === 0
        ? { ok: true, profile, command: { name: 'help' } }
        : argumentError(profile);
    case 'profile-status':
      return commandArgs.length === 0
        ? { ok: true, profile, command: { name: 'profile-status' } }
        : argumentError(profile);
    case 'session':
      return parseSessionCommand(profile, commandArgs);
    case 'cap':
      return parseCapabilityCommand(profile, commandArgs);
    default:
      return { ok: false, profile, code: 'UNKNOWN_COMMAND' };
  }
}
