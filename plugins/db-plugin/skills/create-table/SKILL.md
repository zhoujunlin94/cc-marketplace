---
name: create-table
description: Generate MySQL CREATE TABLE DDL statements following the company's MySQL Database Design Specifications.
---

## When to use

When the user asks to create a table, generate a DDL, or define a table structure.

## Rules (all mandatory unless marked as suggestion)

### Naming
- Table and column names must be within 32 characters.
- Table names: only letters, digits, and underscores, all lowercase.
- Table names must be module-prefixed (e.g., `sz_` for 师资系统, `qd_` for 渠道系统). Ask for the module prefix if not provided.

### Table-level
- Must explicitly specify `CHARSET=utf8mb4`.
- Must explicitly specify `ENGINE=InnoDB` (default unless otherwise specified).
- Must have `COMMENT` on the table.

### Primary Key
- Must have `id` as primary key, type `int UNSIGNED NOT NULL AUTO_INCREMENT`, with comment '主键ID'.
- Primary key name must start with `pk_`.
- Primary key values must never be updated (enforce in application logic).
- Business identifiers (e.g., `user_id`, `order_id`) must NOT be the primary key; use indexes or unique indexes instead.

### Columns
- All columns must be `NOT NULL` with appropriate `DEFAULT` values.
- All columns must have `COMMENT`.
- Use `utf8mb4` charset for all string columns.

### Type Selection
- Auto-increment column: use `int`.
- Status/type fields with few distinct values: use `tinyint` or `smallint`.
- Do NOT use `ENUM` or `SET`; use `tinyint` or `smallint` instead.
- Text data: prefer `varchar` over `char`. Max ~2000 characters for varchar.
- Time fields: prefer `datetime`. `timestamp` range is limited (1970-2038). Alternatively, use `int` with `unix_timestamp()`/`from_unixtime()`.

### Audit Fields (for core tables like user, money-related)
- Must have `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP.
- Must have `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP.

### Indexes
- Primary key: `id int auto_increment` (enforced above).
- Primary key names start with `pk_`, unique keys with `uniq_`, ordinary indexes with `idx_`. All lowercase.
- Index type must be `BTREE` (default for InnoDB).
- Maximum 8 indexes per table.
- Prefer composite indexes with highest cardinality column first.
- No redundant indexes (e.g., if `KEY(a,b)` exists, `KEY(a)` is redundant).

### Soft Delete
- Recommend adding `is_deleted` tinyint UNSIGNED NOT NULL DEFAULT 0 for tables that need soft delete.

### Audit Columns (recommended for all tables)
- `created_by` int UNSIGNED NOT NULL DEFAULT 0
- `updated_by` int UNSIGNED NOT NULL DEFAULT 0

## Output Format

Output only the DDL statement followed by a brief explanation of design choices. Use this template:

```sql
CREATE TABLE `table_name` (
    `id` int UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    -- other columns...
    `is_deleted` tinyint UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否被软删除',
    `created_by` int UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_by` int UNSIGNED NOT NULL DEFAULT 0 COMMENT '更新人',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    -- indexes...
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='table comment';
```

## Reference Example

```sql
CREATE TABLE `ms_trigger_sub_object_type_conf` (
    `id` int UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `sub_object_type` int NOT NULL DEFAULT 0 COMMENT '触达对象类型',
    `sub_object_type_name` varchar(32) NOT NULL DEFAULT '' COMMENT '触达对象类型名',
    `skills` text  COMMENT '触达对象执行技能',
    `attachment` varchar(255) NOT NULL DEFAULT '{}' COMMENT '附加参数值',
    `config_label` varchar(32) NOT NULL DEFAULT '' COMMENT '页面label配置',
    `variable_id` int  not null default 0         comment '变量id',
    `is_deleted` tinyint UNSIGNED NOT NULL DEFAULT 0 COMMENT '是否被软删除',
    `created_by` int UNSIGNED NOT NULL DEFAULT 0 COMMENT '创建人',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_by` int UNSIGNED NOT NULL DEFAULT 0 COMMENT '更新人',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `idx_sub_object_type` (`sub_object_type`),
    UNIQUE KEY `uniq_sub_object_type` (`sub_object_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='触达子对象类型配置表';
```
