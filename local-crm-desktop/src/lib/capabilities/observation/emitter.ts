/**
 * V0.2A / W3-2 — Observation Emitter Contract.
 *
 * 最小事件发射接口：
 * - 确定性 API：emit(event) 总是校验 + 规范化 + 冻结后返回同一形状。
 * - 调用方不可变异已发射事件：emitter 保存自己的规范化冻结副本，绝不保存
 *   调用方传入对象 / 嵌套对象的可变引用。
 * - invocation_id 精确保留：同一调用的多个唯一事件（共享 invocation_id）正常接受；
 *   仅 event_id 重复 fail closed（DUPLICATE_EVENT_ID）——不拒绝"一个 invocation_id
 *   对应多个唯一 event_id"这一正常且必需的关系。
 * - 无持久化、无网络、无全局隐藏副作用（进程内单调 id 序列除外，见 events.ts）。
 *
 * 两种实现：
 * - createNoopObservationEmitter：校验后丢弃（集成/测试占位）。
 * - createInMemoryObservationEmitter：进程内只读历史（通用工具：测试与未来
 *   无持久化集成；不是审计存储）。
 *
 * 不实现：SQLite 审计表、文件日志、远程遥测、HTTP sink。
 */

import {
  normalizeObservationEvent,
  ObservationEventError,
  type ObservationEvent,
} from './events';

export interface ObservationEmitter {
  /**
   * 发射一个事件。返回规范化后的冻结副本；输入的任何不一致都会 fail closed。
   * 调用方事后修改自己的输入对象不会影响已发射的历史事件。
   */
  readonly emit: (event: ObservationEvent) => ObservationEvent;
}

/** 无操作 emitter：校验 + 规范化后丢弃（无存储）。 */
export function createNoopObservationEmitter(): ObservationEmitter {
  return {
    emit: (event: ObservationEvent): ObservationEvent => normalizeObservationEvent(event),
  };
}

/** 内存只读历史 emitter（通用工具；供测试与未来无持久化集成使用，非审计存储）。 */
export interface InMemoryObservationEmitter extends ObservationEmitter {
  /** 已发射事件的只读快照（返回新数组；元素为冻结副本）。 */
  readonly events: () => readonly ObservationEvent[];
  /** 已发射事件数量。 */
  readonly size: () => number;
}

/**
 * 创建内存 emitter。同一 event_id 重复发射抛 DUPLICATE_EVENT_ID——
 * 不存在任何"按 id 覆盖"的可变行为（T15：无 mutable event overwrite）。
 */
export function createInMemoryObservationEmitter(): InMemoryObservationEmitter {
  const stored: ObservationEvent[] = [];
  const ids = new Set<string>();

  return {
    emit: (event: ObservationEvent): ObservationEvent => {
      const normalized = normalizeObservationEvent(event);
      if (ids.has(normalized.event_id)) {
        throw new ObservationEventError(
          'DUPLICATE_EVENT_ID',
          `Observation event id already emitted: ${JSON.stringify(normalized.event_id)}.`,
        );
      }
      ids.add(normalized.event_id);
      stored.push(normalized);
      return normalized;
    },
    events: (): readonly ObservationEvent[] => [...stored],
    size: (): number => stored.length,
  };
}
