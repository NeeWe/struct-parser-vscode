import * as path from 'path';
import { StructParserService } from '../parser/service';

/**
 * Test script for StructParserService.parseFile()
 *
 * Usage:
 *   npm run compile
 *   node out/test/test_parseFile.js
 */

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

    const testFile = path.resolve(__dirname, '../../test/test_resources/test_structs.h');
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

    console.log('\n========================================');
    console.log('Test complete.');
    console.log('========================================');

    // Exit with error code if parsing failed completely
    process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
    console.error('Test failed with exception:', err);
    process.exit(1);
});
