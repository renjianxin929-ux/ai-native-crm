/** User-facing execution lifecycle. No engineering identifiers. */

import { getAppLocale, t } from '../i18n/appLocale';

export type UserExecutionState = string;

export function mapUserExecutionState(input: {
  readonly sessionBusy?: boolean;
  readonly confirming?: boolean;
  readonly awaitingConfirmation?: boolean;
  readonly completed?: boolean;
  readonly failed?: boolean;
}): UserExecutionState {
  if (input.failed) return t('exec.failed');
  if (input.completed) return t('exec.done');
  if (input.confirming) return t('exec.running');
  if (input.awaitingConfirmation) return t('exec.awaitingConfirm');
  if (input.sessionBusy) return t('exec.processing');
  return t('exec.processing');
}

export function explainUnchangedCrmError(message: string): string {
  const trimmed = message.trim();
  if (/does not exist|已经不存在/i.test(trimmed)) {
    return t('error.unknown').startsWith('Something')
      ? ['No change was made.', 'This customer no longer exists.', 'CRM is unchanged.'].join('\n')
      : ['没有完成修改。', '这个客户已经不存在。', 'CRM 没有发生任何变化。'].join('\n');
  }
  if (/Tool execution failed/i.test(trimmed)) {
    return getAppLocale() === 'en-US'
      ? ['This action did not complete.', 'Execution failed.', 'CRM is unchanged.'].join('\n')
      : ['没有完成这次操作。', '执行没有成功。', 'CRM 没有发生任何变化。'].join('\n');
  }
  return trimmed;
}
