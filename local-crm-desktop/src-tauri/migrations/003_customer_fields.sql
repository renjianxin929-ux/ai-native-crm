-- Migration 003: Add structured customer fields (v0.3.0)
-- Splits website, region, industry out of `notes` into dedicated columns.

ALTER TABLE customers ADD COLUMN website TEXT;
ALTER TABLE customers ADD COLUMN region TEXT;
ALTER TABLE customers ADD COLUMN industry TEXT;
