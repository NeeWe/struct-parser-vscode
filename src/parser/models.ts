/**
 * 结构体和字段的数据模型
 */

/**
 * 字段定义
 * type 可能取值:
 * - uint1 ~ uint32: 基本位宽类型
 * - struct/union 名称: 引用已定义的类型
 * - anonymous_struct/anonymous_union: 匿名嵌套结构
 */
export interface Field {
  name: string;
  type: string;
  bits: number;
  offset: number;
  nestedStruct?: Struct;
  nestedUnion?: Union;
}

export interface Struct {
  name: string;
  type: string;
  bits: number;
  offset: number;
  anonymous: boolean;
  fields: Field[];
}

export interface Union {
  name: string;
  type: string;
  bits: number;
  offset: number;
  anonymous: boolean;
  fields: Field[];
}



export interface ParseResult {
  structs: Struct[];
  unions: Union[];
  errors: string[];
  success: boolean;
}

/**
 * 类型系统 - 支持的位宽类型
 */
export const TYPE_SIZES: Map<string, number> = new Map([
  ['uint1', 1],
  ['uint2', 2],
  ['uint3', 3],
  ['uint4', 4],
  ['uint5', 5],
  ['uint6', 6],
  ['uint7', 7],
  ['uint8', 8],
  ['uint9', 9],
  ['uint10', 10],
  ['uint11', 11],
  ['uint12', 12],
  ['uint13', 13],
  ['uint14', 14],
  ['uint15', 15],
  ['uint16', 16],
  ['uint17', 17],
  ['uint18', 18],
  ['uint19', 19],
  ['uint20', 20],
  ['uint21', 21],
  ['uint22', 22],
  ['uint23', 23],
  ['uint24', 24],
  ['uint25', 25],
  ['uint26', 26],
  ['uint27', 27],
  ['uint28', 28],
  ['uint29', 29],
  ['uint30', 30],
  ['uint31', 31],
  ['uint32', 32],
]);

/**
 * 获取类型的位宽
 */
export function getTypeBits(typeName: string): number | null {
  // 直接查找
  if (TYPE_SIZES.has(typeName)) {
    return TYPE_SIZES.get(typeName)!;
  }

  // 尝试匹配 uintN 模式
  const match = typeName.match(/^uint(\d+)$/);
  if (match) {
    const bits = parseInt(match[1], 10);
    if (bits >= 1 && bits <= 32) {
      return bits;
    }
  }

  return null;
}
