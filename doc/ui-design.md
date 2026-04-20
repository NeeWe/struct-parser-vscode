# Struct Parser VS Code 插件 UI 设计文档

## 1. 设计概述

### 1.1 设计理念

- **简洁专业**: 符合开发者工具审美，减少视觉干扰
- **信息密度**: 在有限空间展示更多有效信息
- **交互直观**: 降低学习成本，一眼看懂操作方式
- **主题适配**: 完美融入 VS Code 各种主题

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| 一致性 | 遵循 VS Code 设计规范，使用原生组件风格 |
| 可读性 | 重要信息突出，层级分明 |
| 反馈感 | 操作有明确反馈，状态变化可见 |
| 效率优先 | 减少点击次数，常用功能触手可及 |

---

## 2. 色彩系统

### 2.1 主色调

```css
/* 使用 VS Code 主题变量，确保主题适配 */
--sp-primary: var(--vscode-button-background);        /* 主按钮 */
--sp-primary-hover: var(--vscode-button-hoverBackground);
--sp-secondary: var(--vscode-badge-background);       /* 次要元素 */
--sp-accent: var(--vscode-focusBorder);               /* 强调色 */
```

### 2.2 功能色

```css
/* 字段类型标识 */
--sp-type-struct: #4EC9B0;      /* 结构体 - 青绿色 */
--sp-type-union: #C586C0;       /* 联合体 - 紫色 */
--sp-type-uint: #9CDCFE;        /* 无符号整数 - 浅蓝 */
--sp-type-bool: #569CD6;        /* 布尔 - 蓝色 */

/* 状态色 */
--sp-success: #4EC9B0;          /* 成功 - 青绿 */
--sp-warning: #CCA700;          /* 警告 - 金黄 */
--sp-error: #F48771;            /* 错误 - 橙红 */
--sp-info: #75BEFF;             /* 信息 - 天蓝 */
```

### 2.3 数据可视化色（位域图）

```css
--sp-bit-0: #FF6B6B;   --sp-bit-1: #4ECDC4;
--sp-bit-2: #45B7D1;   --sp-bit-3: #96CEB4;
--sp-bit-4: #FFEAA7;   --sp-bit-5: #DDA0DD;
--sp-bit-6: #98D8C8;   --sp-bit-7: #F7DC6F;
```

---

## 3. 字体规范

### 3.1 字体族

```css
/* 界面文字 */
font-family: var(--vscode-font-family);

/* 代码/数值 */
font-family: var(--vscode-editor-font-family), 'Fira Code', 'JetBrains Mono', monospace;
```

### 3.2 字号层级

| 层级 | 用途 | 字号 | 字重 |
|------|------|------|------|
| H1 | 面板标题 | 20px | 600 |
| H2 | 区域标题 | 14px | 600 |
| H3 | 卡片标题 | 13px | 500 |
| Body | 正文 | 13px | 400 |
| Small | 辅助文字 | 12px | 400 |
| Mono | 数值/代码 | 13px | 400 |

---

## 4. 间距系统

### 4.1 基础单位

以 4px 为基础单位：

```css
--sp-unit: 4px;
--sp-xs: 4px;    /* 紧凑间距 */
--sp-sm: 8px;    /* 小间距 */
--sp-md: 12px;   /* 标准间距 */
--sp-lg: 16px;   /* 大间距 */
--sp-xl: 24px;   /* 区域间距 */
```

### 4.2 组件间距

| 场景 | 数值 |
|------|------|
| 卡片内边距 | 16px |
| 表单元素间距 | 12px |
| 树节点间距 | 8px |
| 按钮内边距 | 8px 16px |
| 图标与文字间距 | 8px |

---

## 5. 组件设计

### 5.1 主面板布局

```
┌─────────────────────────────────────────────────────────────┐
│  ⚡ StructName [struct]          32 bits · 4 bytes          │  ← 顶栏
├─────────────────────────────────────────────────────────────┤
│  0x [ Enter hex value...                        ] [Parse]   │  ← Hex输入
├─────────────────────────────────────────────────────────────┤
│  PARSED FIELDS  5  [🔍 Filter fields...]  [Collapse All]   │  ← 工具栏
│  Name        Type    Offset  Bits  Value        Hex         │  ← 表头
│ ─────────────────────────────────────────────────────────── │
│  ▶ 🔵 field1    uint8   @0      8b    [255]        0xFF     │
│  ▼ 🟣 nested    struct  @8      16b                          │
│    ▶ 🔵 low     uint16  @8      16b   [0]          0x0000   │
│  ▶ 🔵 field2    uint32  @24     32b   [0]          0x0...   │
└─────────────────────────────────────────────────────────────┘
```

布局说明：
- 顶栏：结构体名称 + 类型标签 + 位宽/字节数
- Hex输入：0x前缀 + 输入框 + Parse按钮
- 工具栏：字段计数 + 搜索框 + 折叠/展开按钮
- 表头：CSS Grid 对齐，与数据行共享列定义
- 数据行：CSS Grid 固定列宽，名称组用flex子容器处理缩进

### 5.2 侧边栏设计

```
┌─────────────────┐
│  STRUCT PARSER  │  ← 标题
│  [👁 Hide Zero] │  ← 工具栏
│  [📄 Import]    │
├─────────────────┤
│ 🔍 Search...    │  ← 搜索框
├─────────────────┤
│ ▼ STRUCTS       │  ← 分类（可折叠）
│   ├─ 📐 Control │  ← 结构体项
│   ├─ 📐 Status  │
│   ├─ 📐 Version │
│   └─ 📐 DataReg │
│                 │
│ ▼ UNIONS        │  ← 分类
│   ├─ 📊 Status  │  ← 联合体项
│   └─ 📊 Config  │
└─────────────────┘
```

侧边栏说明：
- 工具栏：Hide Zero 开关 + Import JSON 按钮
- 搜索框：实时过滤结构体列表
- 结构体/联合体分类展示，点击选中后主面板显示解析结果
- 导入JSON时自动去重

### 5.3 字段行设计

```
标准字段行（CSS Grid: 1fr 80px 50px 50px 90px 70px, gap: 16px）：
┌──────────────────────────────────────────────────────────────────────────┐
│ ▶ │ 🔵 │ field_name    │ uint8  │ @0  │ 8b  │ [ 255 ] │ 0xFF          │
│   │    │  ──name-group──│       │     │     │ 输入框   │               │
└──────────────────────────────────────────────────────────────────────────┘

可展开字段行（Value/Hex列显示占位符）：
┌──────────────────────────────────────────────────────────────────────────┐
│ ▼ │ 🟣 │ nested_struct │ struct │ @8  │ 16b │         │               │
└──────────────────────────────────────────────────────────────────────────┘

Grid 列定义：
- 第1列 (1fr): 名称组（indent + expand + icon + name，flex子容器）
- 第2列 (80px): 类型标签
- 第3列 (50px): 偏移量
- 第4列 (50px): 位宽
- 第5列 (90px): 值（叶子节点为输入框，父节点为占位符）
- 第6列 (70px): 十六进制值

字段行组件：
- tree-name-group: flex子容器，包含indent/expand/icon/name
- tree-expand: 展开/折叠箭头（▶/▼），leaf节点隐藏
- tree-icon: 类型圆点（🔵uint 🟣struct 🟣union）
- tree-name: 字段名，溢出省略
- tree-type: 类型标签，颜色区分
- tree-offset: 偏移量，右对齐
- tree-bits: 位宽，右对齐
- tree-value: 可编辑输入框
- tree-hex: 十六进制值，右对齐

### 5.4 位域可视化设计

```
32 位位域图：
┌─────────────────────────────────────────────────────────────────────────────┐
│  31  30  29  28  27  26  25  24  23  22  21  20  19  18  17  16            │
│ ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐                          │
│ │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  ← timeout[16]          │
│ └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘   (颜色: #FF6B6B)       │
│  15  14  13  12  11  10   9   8   7   6   5   4   3   2   1   0            │
│ ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐                          │
│ │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  ← prescale[8]           │
│ └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘   (颜色: #4ECDC4)       │
│                              ┌──┬──┬──┬──┐                                  │
│                              │  │  │  │  │  ← reserved[4]                   │
│                              └──┴──┴──┴──┘   (颜色: #45B7D1)                │
│                                    ┌──┬──┐                                  │
│                                    │  │  │  ← mode[2]                        │
│                                    └──┴──┘   (颜色: #96CEB4)                │
│                                       ┌──┐                                  │
│                                       │  │  ← interrupt[1]                   │
│                                       └──┘   (颜色: #FFEAA7)                │
│                                       ┌──┐                                  │
│                                       │  │  ← enable[1]                      │
│                                       └──┘   (颜色: #DDA0DD)                │
└─────────────────────────────────────────────────────────────────────────────┘

悬停提示：
┌────────────────────────┐
│ timeout                │
│ Offset: 16, Bits: 16   │
│ Value: 0x1234 (4660)   │
│ [Click to locate]      │
└────────────────────────┘
```

### 5.5 搜索界面设计

```
搜索面板：
┌─────────────────────────────────────────────────────────────┐
│ 🔍 Search Fields                              [✕]          │
├─────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────┐   │
│ │ [search...                                    ] [🔍]  │   │
│ └───────────────────────────────────────────────────────┘   │
│                                                             │
│ 12 results found:                                           │
│ ┌───────────────────────────────────────────────────────┐   │
│ │ ▶ status.enable    ControlReg.status.enable           │   │
│ │ ▶ control.enable   DeviceConfig.control.enable        │   │
│ │ ▶ ...                                                 │   │
│ └───────────────────────────────────────────────────────┘   │
│                                                             │
│ [Clear Results]                              [Export]       │
└─────────────────────────────────────────────────────────────┘
```

### 5.6 快捷操作面板

```
底部快捷栏：
┌─────────────────────────────────────────────────────────────┐
│ [📋 Copy Hex] [💾 Save] [📤 Export] [⚙️ Settings] [❓ Help]  │
└─────────────────────────────────────────────────────────────┘

右键菜单：
┌────────────────────────┐
│ Copy Value             │
│ Copy Hex               │
│ Copy Binary            │
│ ─────────────────────  │
│ Highlight in Tree      │
│ ─────────────────────  │
│ Edit Value...          │
└────────────────────────┘
```

---

## 6. 交互动效

### 6.1 过渡动画

```css
/* 展开/折叠 */
transition: all 0.2s ease-in-out;

/* 悬停效果 */
transition: background-color 0.15s ease;

/* 按钮点击 */
transition: transform 0.1s ease;
```

### 6.2 微交互

| 场景 | 反馈 |
|------|------|
| 解析成功 | 结果区域淡入，耗时 < 300ms |
| 字段编辑 | 输入框边框高亮，值实时更新 |
| 复制成功 | Toast 提示 "Copied!" |
| 展开节点 | 箭头旋转 90°，子节点滑入 |
| 搜索匹配 | 匹配项高亮闪烁一次 |

---

## 7. 响应式设计

### 7.1 断点定义

| 断点 | 宽度 | 适配策略 |
|------|------|----------|
| sm | < 400px | 简化布局，隐藏次要信息 |
| md | 400-600px | 标准布局 |
| lg | > 600px | 完整布局，显示所有信息 |

### 7.2 窄屏适配

```
< 400px 时：
- 隐藏二进制列
- 字段名截断显示
- 操作按钮堆叠排列
```

---

## 8. 图标系统

### 8.1 图标规范

| 图标 | 用途 | 尺寸 |
|------|------|------|
| 📁 | 文件夹/分类 | 16px |
| 📂 | 打开文件夹 | 16px |
| 📐 | 结构体 | 16px |
| 📊 | 联合体 | 16px |
| 🔵 | 基础类型 | 12px |
| 🟣 | 复合类型 | 12px |
| ▶/▼ | 展开/折叠 | 10px |
| 📋 | 复制 | 14px |
| 🔍 | 搜索 | 16px |
| ⚙️ | 设置 | 16px |
| 💾 | 保存 | 16px |
| 📤 | 导出 | 16px |

### 8.2 图标风格

- 使用 VS Code Codicons 保持一致性
- 自定义图标使用 SVG，支持主题色
- 所有图标支持深色/浅色主题

---

## 9. 设计资源

### 9.1 CSS 变量定义

```css
/* design-tokens.css */
:root {
  /* Spacing */
  --sp-unit: 4px;
  --sp-xs: calc(var(--sp-unit) * 1);
  --sp-sm: calc(var(--sp-unit) * 2);
  --sp-md: calc(var(--sp-unit) * 3);
  --sp-lg: calc(var(--sp-unit) * 4);
  --sp-xl: calc(var(--sp-unit) * 6);

  /* Border Radius */
  --sp-radius-sm: 4px;
  --sp-radius-md: 6px;
  --sp-radius-lg: 8px;

  /* Shadows */
  --sp-shadow-sm: 0 1px 2px rgba(0,0,0,0.1);
  --sp-shadow-md: 0 2px 4px rgba(0,0,0,0.1);
  --sp-shadow-lg: 0 4px 8px rgba(0,0,0,0.15);

  /* Type Colors */
  --sp-type-struct: #4EC9B0;
  --sp-type-union: #C586C0;
  --sp-type-uint: #9CDCFE;
  --sp-type-bool: #569CD6;

  /* Status Colors */
  --sp-success: #4EC9B0;
  --sp-warning: #CCA700;
  --sp-error: #F48771;
  --sp-info: #75BEFF;
}
```

### 9.2 组件代码示例

```html
<!-- 字段行组件 -->
<div class="sp-field-row">
  <span class="sp-expand-icon">▼</span>
  <span class="sp-type-icon sp-type-struct"></span>
  <span class="sp-field-name">control</span>
  <span class="sp-field-type">struct</span>
  <input class="sp-field-input" type="number" value="255" />
  <span class="sp-field-hex">0xFF</span>
  <span class="sp-field-binary">11111111</span>
  <span class="sp-field-bits">8 bits</span>
  <button class="sp-icon-btn" title="Copy">📋</button>
</div>
```

```css
/* 字段行样式 */
.sp-field-row {
  display: flex;
  align-items: center;
  gap: var(--sp-sm);
  padding: var(--sp-sm) var(--sp-md);
  border-radius: var(--sp-radius-sm);
  transition: background-color 0.15s ease;
}

.sp-field-row:hover {
  background-color: var(--vscode-list-hoverBackground);
}

.sp-field-name {
  font-weight: 600;
  min-width: 150px;
  color: var(--vscode-foreground);
}

.sp-field-type {
  font-size: 12px;
  min-width: 80px;
  color: var(--sp-type-struct);
}

.sp-field-input {
  width: 80px;
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border);
  border-radius: var(--sp-radius-sm);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  font-family: var(--vscode-editor-font-family);
}

.sp-field-input:focus {
  outline: none;
  border-color: var(--sp-accent);
}
```

---

## 10. 设计检查清单

### 10.1 视觉检查

- [ ] 所有颜色使用 VS Code 变量或符合主题
- [ ] 对比度符合 WCAG AA 标准
- [ ] 字体大小层级清晰
- [ ] 间距统一使用设计系统
- [ ] 图标风格一致

### 10.2 交互检查

- [ ] 所有可点击元素有悬停状态
- [ ] 焦点状态清晰可见
- [ ] 加载状态有反馈
- [ ] 错误状态有明确提示
- [ ] 动画流畅不卡顿

### 10.3 功能检查

- [ ] 深色/浅色主题切换正常
- [ ] 不同缩放比例显示正常
- [ ] 键盘可完全操作
- [ ] 屏幕阅读器可访问

---

*文档版本: v1.0.0*
*更新日期: 2026-04-18*
