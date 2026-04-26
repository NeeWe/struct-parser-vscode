---
name: "struct-union-calculator"
description: "Calculates offset and bits for struct/union fields in a C-like DSL. Invoke when user needs to compute field positions or sizes in structs/unions without padding."
---

# Struct/Union Offset and Bits Calculation Guide

## 1. 基本概念

### 1.1 数据类型
- 只支持 `uint1` 到 `uint32`，代表 1~32 位无符号整数
- 无字符对齐
- 无结构填充

### 1.2 Struct/Union 语法
与 C 语言相同，语法结构如下：

```c
// Struct 定义
struct StructName {
    uintN field1;
    uintM field2;
    // ...
};

// Union 定义
union UnionName {
    uintN field1;
    uintM field2;
    // ...
};
```

## 2. Offset 计算

### 2.1 Struct Offset 计算
在无填充的情况下，Struct 中字段的 offset 是前所有字段大小的总和。

计算公式：
```
offset(field) = sum(size of all previous fields)
```

示例：
```c
struct Example {
    uint8  a;  // offset: 0, size: 8 bits
    uint16 b;  // offset: 8, size: 16 bits
    uint3  c;  // offset: 24, size: 3 bits
};
```

计算过程：
- `a` 的 offset 是 0（第一个字段）
- `b` 的 offset 是 0 + 8 = 8
- `c` 的 offset 是 8 + 16 = 24

### 2.2 Union Offset 计算
Union 中所有字段共享同一块内存空间，因此它们的绝对 offset 相同，等于 Union 本身的起始 offset。

示例 1：独立 Union
```c
union Example {
    uint8  a;  // 绝对 offset: 0, size: 8 bits
    uint16 b;  // 绝对 offset: 0, size: 16 bits
    uint32 c;  // 绝对 offset: 0, size: 32 bits
};
```

示例 2：嵌套在结构体中的 Union
```c
struct Outer {
    uint16 x;  // 绝对 offset: 0, size: 16 bits
    union Inner {
        uint8  a;  // 绝对 offset: 16, size: 8 bits
        uint16 b;  // 绝对 offset: 16, size: 16 bits
    } y;
};
```

## 3. Bits 计算

### 3.1 字段大小计算
每个字段的大小由其数据类型决定：
- `uint1` 到 `uint32` 分别对应 1 到 32 位

### 3.2 结构体总大小计算
Struct 的总大小是所有字段大小的总和。

计算公式：
```
total_size = sum(size of all fields)
```

示例：
```c
struct SizeExample {
    uint8  a;  // 8 bits
    uint16 b;  // 16 bits
    uint3  c;  // 3 bits
};
// 总大小: 8 + 16 + 3 = 27 bits
```

Union 的总大小是其最大字段的大小。

计算公式：
```
total_size = max(size of all fields)
```

示例：
```c
union SizeExample {
    uint8  a;  // 8 bits
    uint16 b;  // 16 bits
    uint32 c;  // 32 bits
};
// 总大小: max(8, 16, 32) = 32 bits
```

## 4. 详细示例分析

### 4.1 Struct 示例

```c
struct DetailedExample {
    uint1  flag;     // offset: 0, size: 1 bit
    uint7  status;   // offset: 1, size: 7 bits
    uint16 value;    // offset: 8, size: 16 bits
    uint4  type;     // offset: 24, size: 4 bits
    uint28 padding;  // offset: 28, size: 28 bits
};
```

计算过程：
- `flag`：offset = 0, size = 1
- `status`：offset = 0 + 1 = 1, size = 7
- `value`：offset = 1 + 7 = 8, size = 16
- `type`：offset = 8 + 16 = 24, size = 4
- `padding`：offset = 24 + 4 = 28, size = 28
- 总大小：1 + 7 + 16 + 4 + 28 = 56 bits

### 4.2 Union 示例

```c
union DetailedUnion {
    struct {
        uint8  header;  // offset: 0, size: 8 bits
        uint16 data;    // offset: 8, size: 16 bits
    } packet;
    uint24 raw;         // offset: 0, size: 24 bits
};
```

计算过程：
- `packet.header`：offset = 0, size = 8
- `packet.data`：offset = 8, size = 16
- `raw`：offset = 0, size = 24
- 总大小：max(8+16, 24) = 24 bits

## 5. 常见问题与解决方案

### 5.1 大小计算验证
可以通过以下步骤验证大小计算：
1. 列出每个字段的 offset 和 size
2. 计算总大小
3. 验证最后一个字段的 offset + size 是否等于总大小

### 5.2 嵌套结构体
嵌套结构体的计算方法与普通字段相同，将其视为一个整体。

示例：
```c
struct Inner {
    uint8  a;
    uint16 b;
};

struct Outer {
    uint32 x;
    struct Inner y;  // offset: 32, size: 24 bits
    uint4  z;
};
```

计算过程：
- `x`：offset = 0, size = 32
- `y`：offset = 32, size = 8 + 16 = 24
- `z`：offset = 32 + 24 = 56, size = 4
- 总大小：32 + 24 + 4 = 60 bits

## 6. 计算工具与技巧

### 6.1 手动计算步骤
1. 从第一个字段开始，offset 为 0
2. 对于每个字段：
   - 记录当前 offset
   - 计算字段大小
   - 下一个字段的 offset = 当前 offset + 当前字段大小
3. 最后一个字段的 offset + 大小 = 总大小

### 6.2 验证方法
- 对于 Struct：所有字段大小之和等于总大小
- 对于 Union：最大字段大小等于总大小
- 所有字段的 offset 必须是非负整数
- 字段的 offset + 大小不能超过总大小

## 7. 实际应用示例

### 7.1 网络协议解析
```c
struct EthernetHeader {
    uint48 destination;  // 目标MAC地址
    uint48 source;       // 源MAC地址
    uint16 type;         // 以太网类型
};
// 总大小: 48 + 48 + 16 = 112 bits = 14 bytes
```

### 7.2 硬件寄存器映射
```c
struct ControlRegister {
    uint1  enable;       // 使能位
    uint3  mode;         // 模式选择
    uint4  reserved;     // 保留位
    uint8  value;        // 数值
};
// 总大小: 1 + 3 + 4 + 8 = 16 bits = 2 bytes
```

## 8. 总结

- Struct 中字段的绝对 offset 是前所有字段大小的总和
- Union 中所有字段的绝对 offset 相同，等于 Union 本身的起始 offset
- 无填充情况下，结构体大小是所有字段大小的总和
- 无填充情况下，联合体大小是最大字段的大小
- 嵌套结构体的计算方法与普通字段相同

通过掌握这些计算规则，可以准确分析和设计基于位的结构体和联合体，适用于网络协议、硬件寄存器、序列化等场景。