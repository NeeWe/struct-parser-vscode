// 测试 Parse 功能
import * as fs from 'fs';

interface StructField {
    name: string;
    type: string;
    bits: number;
    offset: number;
    children?: StructField[];
}

interface StructDef {
    name: string;
    type: string;
    size_bits: number;
    fields: StructField[];
}

interface StructJson {
    structs: StructDef[];
    unions: StructDef[];
}

interface ParsedField extends StructField {
    binary: string;
    value: number;
    hex: string;
}

// 模拟解析函数
function parseHexValue(hexValue: string, structDef: StructDef, structData: StructJson): ParsedField[] {
    const hexClean = hexValue.replace(/^0x/i, '');
    let fullValue = BigInt('0x' + hexClean);
    
    // Handle data width
    const maxValue = (BigInt(1) << BigInt(structDef.size_bits)) - BigInt(1);
    
    if (fullValue > maxValue) {
        fullValue = fullValue & maxValue;
    }
    
    const binaryValue = fullValue.toString(2).padStart(structDef.size_bits, '0');
    
    return parseFields(structDef.fields, binaryValue, fullValue, structDef.size_bits, structData);
}

function parseFields(fields: StructField[], binaryValue: string, fullValue: bigint, totalBits: number, structData: StructJson, parentOffset: number = 0): ParsedField[] {
    return fields.map(field => {
        // binaryValue: MSB at index 0, LSB at index length-1
        // field.offset: offset from LSB
        // So we need to extract from the right side of binary string
        const absoluteOffset = parentOffset + field.offset;
        // Calculate position from the right (LSB) side
        // binaryValue is MSB-first, so we need to reverse our thinking
        // If offset=0, bits=1, we want the last bit of binaryValue
        const startFromRight = absoluteOffset;
        const endFromRight = absoluteOffset + field.bits;
        // Convert to indices from left (MSB)
        const startPos = totalBits - endFromRight;
        const endPos = totalBits - startFromRight;
        const fieldBits = binaryValue.substring(startPos, endPos);
        const fieldValue = parseInt(fieldBits, 2);
        
        const parsedField: ParsedField = {
            ...field,
            binary: fieldBits,
            value: fieldValue,
            hex: '0x' + fieldValue.toString(16).toUpperCase()
        };

        // Handle nested structs/unions
        if (field.children && field.children.length > 0) {
            (parsedField as any).children = parseFields(
                field.children, 
                fieldBits, 
                BigInt(fieldValue), 
                field.bits,
                structData,
                0
            );
        } else if ((field.type === 'struct' || field.type === 'union') && structData) {
            const nestedDef = structData.structs.find(s => s.name === field.name) ||
                             structData.unions.find(s => s.name === field.name);
            if (nestedDef && nestedDef.fields) {
                (parsedField as any).children = parseFields(
                    nestedDef.fields,
                    fieldBits,
                    BigInt(fieldValue),
                    field.bits,
                    structData,
                    0
                );
            }
        }

        return parsedField;
    });
}

// 加载测试数据
const jsonPath = '/Users/dingwei/workspace/run/output/structs.json';
const content = fs.readFileSync(jsonPath, 'utf-8');
const structData: StructJson = JSON.parse(content);

console.log('=== Struct Parser Test ===\n');
console.log('Available structs:', structData.structs.map(s => s.name).join(', '));
console.log('Available unions:', structData.unions.map(s => s.name).join(', '));

// 测试 ControlReg
const controlReg = structData.structs.find(s => s.name === 'ControlReg');
if (controlReg) {
    console.log('\n--- Testing ControlReg ---');
    console.log('Size:', controlReg.size_bits, 'bits');
    console.log('Fields:', controlReg.fields.map(f => `${f.name}(${f.bits}bits@${f.offset})`).join(', '));
    
    // 测试值: enable=1, interrupt=1, mode=3, reserved=0, prescale=0xFF, timeout=0x1234
    // Layout (LSB first, from right to left): 
    //   timeout(16) + prescale(8) + reserved(4) + mode(2) + interrupt(1) + enable(1)
    //   = 16 + 8 + 4 + 2 + 1 + 1 = 32 bits
    // Binary (MSB first, left to right):
    //   timeout: 0001001000110100
    //   prescale: 11111111
    //   reserved: 0000
    //   mode: 11
    //   interrupt: 1
    //   enable: 1
    // Full: 00010010001101001111111100001111
    // Hex: 0x1234FF0F
    const testHex = '1234FF0F';
    console.log('\nInput hex:', testHex);
    
    // Debug: show binary representation
    const hexClean = testHex.replace(/^0x/i, '');
    let fullValue = BigInt('0x' + hexClean);
    const binaryValue = fullValue.toString(2).padStart(32, '0');
    console.log('Binary (MSB first):', binaryValue);
    console.log('Index:              ', '0         1         2         3');
    console.log('                    ', '01234567890123456789012345678901');
    
    const parsed = parseHexValue(testHex, controlReg, structData);
    console.log('\nParsed fields:');
    parsed.forEach(field => {
        console.log(`  ${field.name}: value=${field.value}, hex=${field.hex}, binary=${field.binary}, bits=${field.bits}@${field.offset}`);
    });
    
    // 验证结果
    const enable = parsed.find(f => f.name === 'enable');
    const interrupt = parsed.find(f => f.name === 'interrupt');
    const mode = parsed.find(f => f.name === 'mode');
    const prescale = parsed.find(f => f.name === 'prescale');
    const timeout = parsed.find(f => f.name === 'timeout');
    
    console.log('\nVerification:');
    console.log('  enable:', enable?.value === 1 ? '✓ PASS' : '✗ FAIL', '(expected 1, got', enable?.value + ')');
    console.log('  interrupt:', interrupt?.value === 1 ? '✓ PASS' : '✗ FAIL', '(expected 1, got', interrupt?.value + ')');
    console.log('  mode:', mode?.value === 3 ? '✓ PASS' : '✗ FAIL', '(expected 3, got', mode?.value + ')');
    console.log('  prescale:', prescale?.value === 255 ? '✓ PASS' : '✗ FAIL', '(expected 255, got', prescale?.value + ')');
    console.log('  timeout:', timeout?.value === 0x1234 ? '✓ PASS' : '✗ FAIL', '(expected 4660, got', timeout?.value + ')');
}

// 测试 Version
const version = structData.structs.find(s => s.name === 'Version');
if (version) {
    console.log('\n--- Testing Version ---');
    console.log('Size:', version.size_bits, 'bits');
    console.log('Fields:', version.fields.map(f => `${f.name}(${f.bits}bits@${f.offset})`).join(', '));
    
    // 测试值: major=1, minor=2, patch=0x0304
    // Layout: patch(16) + minor(8) + major(8)
    // Binary: 0000001100000100 00000010 00000001
    // Hex: 0x03040201
    const testHex = '03040201';
    console.log('\nInput hex:', testHex);
    
    // Debug
    const hexClean = testHex.replace(/^0x/i, '');
    let fullValue = BigInt('0x' + hexClean);
    const binaryValue = fullValue.toString(2).padStart(32, '0');
    console.log('Binary (MSB first):', binaryValue);
    
    const parsed = parseHexValue(testHex, version, structData);
    console.log('\nParsed fields:');
    parsed.forEach(field => {
        console.log(`  ${field.name}: value=${field.value}, hex=${field.hex}, binary=${field.binary}`);
    });
    
    const major = parsed.find(f => f.name === 'major');
    const minor = parsed.find(f => f.name === 'minor');
    const patch = parsed.find(f => f.name === 'patch');
    
    console.log('\nVerification:');
    console.log('  major:', major?.value === 1 ? '✓ PASS' : '✗ FAIL', '(expected 1, got', major?.value + ')');
    console.log('  minor:', minor?.value === 2 ? '✓ PASS' : '✗ FAIL', '(expected 2, got', minor?.value + ')');
    console.log('  patch:', patch?.value === 0x0304 ? '✓ PASS' : '✗ FAIL', '(expected 772, got', patch?.value + ')');
}

console.log('\n=== Test Complete ===');
