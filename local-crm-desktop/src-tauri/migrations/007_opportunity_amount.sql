-- Migration 007: Personal Opportunity Board Data Foundation (V0.2C / C0)
-- 新增一个窄义可空商机金额列（active opportunity amount）。
-- 与 src/lib/db.ts 的 ensureCustomerSchema 保持同一契约（运行时由前端 ensure*
-- 幂等函数驱动，PRAGMA table_info 后逐列补齐；本文件为惯例对齐与审计用途）。
--
-- 语义（C0 冻结）：
--   opportunity_amount = 用户确认/显式记录的期望商业金额（expected commercial amount）。
--   绝不：AI 估算公司价值、阶段派生默认值、自动推断金额、假演示金额。
--   UNKNOWN 必须保持 NULL；NULL 绝不渲染或聚合为 0。
--   与 deal_amount（成交金额，已成交交易金额）语义分离，绝不重解释。

ALTER TABLE customers ADD COLUMN opportunity_amount REAL;
