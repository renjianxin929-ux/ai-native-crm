/**
 * Cause-specific user-facing errors.
 * Do not collapse unrelated failures into “没有找到匹配客户”.
 */

export type QueryFailureKind =
  | 'no_name_match'
  | 'no_region_match'
  | 'missing_required_input'
  | 'model_unavailable'
  | 'provider_unauthorized'
  | 'invalid_value'
  | 'unsupported_request'
  | 'write_failed'
  | 'confirmation_cancelled';

export function formatQueryFailure(kind: QueryFailureKind, detail?: string): string {
  switch (kind) {
    case 'no_name_match':
      return `CRM 中目前没有名称包含“${detail ?? '该词'}”的客户。CRM 未变更。`;
    case 'no_region_match':
      return `CRM 中目前没有地区字段为“${detail ?? ''}”的客户。CRM 未变更。可改用名称包含该词的查找。`;
    case 'missing_required_input':
      return `还缺少必要信息${detail ? `：${detail}` : ''}。CRM 未变更。请补充后再试。`;
    case 'model_unavailable':
      return '当前 AI 模型不可用，该请求未执行，CRM 未变更。请在设置中配置模型后重试。';
    case 'provider_unauthorized':
      return '模型服务未授权或密钥无效。该请求未执行，CRM 未变更。请检查 AI 设置。';
    case 'invalid_value':
      return `提供的值无效${detail ? `（${detail}）` : ''}。CRM 未变更。请按提示修正。`;
    case 'unsupported_request':
      return '当前版本不支持该请求。CRM 未变更。请改用已支持的客户、跟进、拜访或商机操作。';
    case 'write_failed':
      return `写入未完成${detail ? `：${detail}` : ''}。CRM 没有发生这次变更。`;
    case 'confirmation_cancelled':
      return '已取消确认。CRM 没有发生任何变化。';
  }
}
