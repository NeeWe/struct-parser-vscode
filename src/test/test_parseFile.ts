import * as path from 'path';
import { StructParserService } from '../parser/service';
import { Field, ParseResult } from '../parser/models';

/**
 * Test script for StructParserService.parseFile()
 *
 * Usage:
 *   npm run compile
 *   node out/test/test_parseFile.js
 */

function hasFieldByName(fields: Field[], name: string): boolean {
    return fields.some((f) => f.name === name);
}

function findFieldByName(fields: Field[], name: string): Field | undefined {
    return fields.find((f) => f.name === name);
}

function assertCase(result: ParseResult, filePath: string): string[] {
    const issues: string[] = [];
    const fileName = path.basename(filePath);

    const assert = (ok: boolean, message: string) => {
        if (!ok) {
            issues.push(`[${fileName}] ${message}`);
        }
    };

    if (fileName === 'test_structs.h') {
        const statusUnion = result.unions.find((u) => u.name === 'StatusRegister');
        assert(!!statusUnion, 'missing union StatusRegister');
        if (statusUnion) {
            assert(hasFieldByName(statusUnion.fields, 'raw'), 'StatusRegister missing field raw');
            assert(hasFieldByName(statusUnion.fields, 'packed'), 'StatusRegister missing field packed');
        }
    }

    if (fileName === 'union_nested_cases.h') {
        const innerMode = result.unions.find((u) => u.name === 'InnerMode');
        const innerPayload = result.unions.find((u) => u.name === 'InnerPayload');
        const topLevelMux = result.unions.find((u) => u.name === 'TopLevelMux');
        const nestedContainer = result.structs.find((s) => s.name === 'NestedUnionContainer');

        assert(!!innerMode, 'missing union InnerMode');
        assert(!!innerPayload, 'missing union InnerPayload');
        assert(!!topLevelMux, 'missing union TopLevelMux');
        assert(!!nestedContainer, 'missing struct NestedUnionContainer');

        if (innerMode) {
            const bits = findFieldByName(innerMode.fields, 'bits');
            assert(!!bits?.nestedStruct, 'InnerMode.bits should contain nested struct');
            if (bits?.nestedStruct) {
                assert(hasFieldByName(bits.nestedStruct.fields, 'mode'), 'InnerMode.bits missing mode');
                assert(hasFieldByName(bits.nestedStruct.fields, 'parity'), 'InnerMode.bits missing parity');
                assert(hasFieldByName(bits.nestedStruct.fields, 'code'), 'InnerMode.bits missing code');
            }
        }

        if (nestedContainer) {
            const body = findFieldByName(nestedContainer.fields, 'body');
            assert(!!body?.nestedUnion, 'NestedUnionContainer.body should contain nested union');
            const decoded = body?.nestedUnion ? findFieldByName(body.nestedUnion.fields, 'decoded') : undefined;
            assert(!!decoded?.nestedStruct, 'NestedUnionContainer.body.decoded should contain nested struct');
            const payloadAny = decoded?.nestedStruct ? findFieldByName(decoded.nestedStruct.fields, 'payload_any') : undefined;
            assert(!!payloadAny?.nestedUnion, 'decoded.payload_any should contain nested union');
            const payloadU = payloadAny?.nestedUnion ? findFieldByName(payloadAny.nestedUnion.fields, 'payload_u') : undefined;
            assert(!!payloadU?.nestedUnion, 'payload_any.payload_u should resolve to union InnerPayload');
        }

        if (topLevelMux) {
            assert(hasFieldByName(topLevelMux.fields, 'raw32'), 'TopLevelMux missing raw32');
            assert(hasFieldByName(topLevelMux.fields, 'nested'), 'TopLevelMux missing nested');
            assert(hasFieldByName(topLevelMux.fields, 'flat'), 'TopLevelMux missing flat');
        }
    }

    return issues;
}

async function main() {
    const service = new StructParserService();

    // Check GCC availability
    const gccAvailable = StructParserService.isGccAvailable();
    console.log('========================================');
    console.log('StructParserService.parseFile() Test');
    console.log('========================================');
    console.log(`GCC available: ${gccAvailable}`);
    if (gccAvailable) {
        console.log(`GCC version: ${StructParserService.getGccVersion()}`);
    }
    console.log('');

    const testFiles = [
        path.resolve(__dirname, '../../test/test_resources/test_structs.h'),
        path.resolve(__dirname, '../../test/test_resources/union_nested_cases.h')
    ];

    let allPassed = true;

    for (const testFile of testFiles) {
        console.log(`Test file: ${testFile}`);
        console.log('');

        // Run parseFile
        const result = await service.parseFile(testFile);
        console.log(service.generateJson(result));

        // Print results
        console.log('---------- Parse Result ----------');
        console.log(`Success: ${result.success}`);
        console.log(`Structs: ${result.structs.length}`);
        console.log(`Unions:  ${result.unions.length}`);
        console.log(`Errors:  ${result.errors.length}`);
        console.log('');

        if (result.errors.length > 0) {
            console.log('---------- Errors/Warnings ----------');
            result.errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
            console.log('');
        }

        if (result.structs.length > 0) {
            console.log('---------- Structs ----------');
            result.structs.forEach((s) => {
                console.log(`\n  struct ${s.name} (${s.bits} bits, ${s.fields.length} fields)`);
                s.fields.forEach((f) => {
                    const nested = f.nestedStruct || f.nestedUnion;
                    const nestedInfo = nested ? ` [nested ${f.type}: ${nested.fields.length} fields]` : '';
                    console.log(`    ${f.type} ${f.name}  @ offset=${f.offset}, bits=${f.bits}${nestedInfo}`);
                });
            });
        }

        if (result.unions.length > 0) {
            console.log('\n---------- Unions ----------');
            result.unions.forEach((u) => {
                console.log(`\n  union ${u.name} (${u.bits} bits, ${u.fields.length} members)`);
                u.fields.forEach((f) => {
                    const nested = f.nestedStruct || f.nestedUnion;
                    const nestedInfo = nested ? ` [nested ${f.type}: ${nested.fields.length} fields]` : '';
                    console.log(`    ${f.type} ${f.name}  @ offset=${f.offset}, bits=${f.bits}${nestedInfo}`);
                });
            });
        }

        const issues = assertCase(result, testFile);
        if (issues.length > 0) {
            console.log('\n---------- Assertions ----------');
            issues.forEach((issue) => console.log(`  ✗ ${issue}`));
            console.log('');
        } else {
            console.log('---------- Assertions ----------');
            console.log('  ✓ All assertions passed');
            console.log('');
        }

        allPassed = allPassed && result.success && issues.length === 0;
        console.log('\n----------------------------------------\n');
    }

    console.log('\n========================================');
    console.log('Test complete.');
    console.log('========================================');

    // Exit with error code if parsing failed completely
    process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
    console.error('Test failed with exception:', err);
    process.exit(1);
});
