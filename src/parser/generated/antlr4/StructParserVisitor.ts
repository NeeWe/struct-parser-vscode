// Generated from ./antlr4/StructParser.g4 by ANTLR 4.9.0-SNAPSHOT


import { ParseTreeVisitor } from "antlr4ts/tree/ParseTreeVisitor";

import { ProgramContext } from "./StructParserParser";
import { ItemContext } from "./StructParserParser";
import { OtherContentContext } from "./StructParserParser";
import { DeclarationContext } from "./StructParserParser";
import { StructDeclarationContext } from "./StructParserParser";
import { UnionDeclarationContext } from "./StructParserParser";
import { TypedefDeclarationContext } from "./StructParserParser";
import { TypeDefinitionContext } from "./StructParserParser";
import { FieldListContext } from "./StructParserParser";
import { FieldContext } from "./StructParserParser";
import { OtherFieldContext } from "./StructParserParser";
import { TypeSpecifierContext } from "./StructParserParser";
import { FieldNameContext } from "./StructParserParser";


/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `StructParserParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export interface StructParserVisitor<Result> extends ParseTreeVisitor<Result> {
	/**
	 * Visit a parse tree produced by `StructParserParser.program`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitProgram?: (ctx: ProgramContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.item`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitItem?: (ctx: ItemContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.otherContent`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitOtherContent?: (ctx: OtherContentContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.declaration`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitDeclaration?: (ctx: DeclarationContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.structDeclaration`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitStructDeclaration?: (ctx: StructDeclarationContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.unionDeclaration`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitUnionDeclaration?: (ctx: UnionDeclarationContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.typedefDeclaration`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitTypedefDeclaration?: (ctx: TypedefDeclarationContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.typeDefinition`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitTypeDefinition?: (ctx: TypeDefinitionContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.fieldList`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFieldList?: (ctx: FieldListContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.field`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitField?: (ctx: FieldContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.otherField`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitOtherField?: (ctx: OtherFieldContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.typeSpecifier`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitTypeSpecifier?: (ctx: TypeSpecifierContext) => Result;

	/**
	 * Visit a parse tree produced by `StructParserParser.fieldName`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFieldName?: (ctx: FieldNameContext) => Result;
}

