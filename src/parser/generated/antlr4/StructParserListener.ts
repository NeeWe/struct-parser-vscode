// Generated from ./antlr4/StructParser.g4 by ANTLR 4.9.0-SNAPSHOT


import { ParseTreeListener } from "antlr4ts/tree/ParseTreeListener";

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
 * This interface defines a complete listener for a parse tree produced by
 * `StructParserParser`.
 */
export interface StructParserListener extends ParseTreeListener {
	/**
	 * Enter a parse tree produced by `StructParserParser.program`.
	 * @param ctx the parse tree
	 */
	enterProgram?: (ctx: ProgramContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.program`.
	 * @param ctx the parse tree
	 */
	exitProgram?: (ctx: ProgramContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.item`.
	 * @param ctx the parse tree
	 */
	enterItem?: (ctx: ItemContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.item`.
	 * @param ctx the parse tree
	 */
	exitItem?: (ctx: ItemContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.otherContent`.
	 * @param ctx the parse tree
	 */
	enterOtherContent?: (ctx: OtherContentContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.otherContent`.
	 * @param ctx the parse tree
	 */
	exitOtherContent?: (ctx: OtherContentContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.declaration`.
	 * @param ctx the parse tree
	 */
	enterDeclaration?: (ctx: DeclarationContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.declaration`.
	 * @param ctx the parse tree
	 */
	exitDeclaration?: (ctx: DeclarationContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.structDeclaration`.
	 * @param ctx the parse tree
	 */
	enterStructDeclaration?: (ctx: StructDeclarationContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.structDeclaration`.
	 * @param ctx the parse tree
	 */
	exitStructDeclaration?: (ctx: StructDeclarationContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.unionDeclaration`.
	 * @param ctx the parse tree
	 */
	enterUnionDeclaration?: (ctx: UnionDeclarationContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.unionDeclaration`.
	 * @param ctx the parse tree
	 */
	exitUnionDeclaration?: (ctx: UnionDeclarationContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.typedefDeclaration`.
	 * @param ctx the parse tree
	 */
	enterTypedefDeclaration?: (ctx: TypedefDeclarationContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.typedefDeclaration`.
	 * @param ctx the parse tree
	 */
	exitTypedefDeclaration?: (ctx: TypedefDeclarationContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.typeDefinition`.
	 * @param ctx the parse tree
	 */
	enterTypeDefinition?: (ctx: TypeDefinitionContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.typeDefinition`.
	 * @param ctx the parse tree
	 */
	exitTypeDefinition?: (ctx: TypeDefinitionContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.fieldList`.
	 * @param ctx the parse tree
	 */
	enterFieldList?: (ctx: FieldListContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.fieldList`.
	 * @param ctx the parse tree
	 */
	exitFieldList?: (ctx: FieldListContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.field`.
	 * @param ctx the parse tree
	 */
	enterField?: (ctx: FieldContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.field`.
	 * @param ctx the parse tree
	 */
	exitField?: (ctx: FieldContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.otherField`.
	 * @param ctx the parse tree
	 */
	enterOtherField?: (ctx: OtherFieldContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.otherField`.
	 * @param ctx the parse tree
	 */
	exitOtherField?: (ctx: OtherFieldContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.typeSpecifier`.
	 * @param ctx the parse tree
	 */
	enterTypeSpecifier?: (ctx: TypeSpecifierContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.typeSpecifier`.
	 * @param ctx the parse tree
	 */
	exitTypeSpecifier?: (ctx: TypeSpecifierContext) => void;

	/**
	 * Enter a parse tree produced by `StructParserParser.fieldName`.
	 * @param ctx the parse tree
	 */
	enterFieldName?: (ctx: FieldNameContext) => void;
	/**
	 * Exit a parse tree produced by `StructParserParser.fieldName`.
	 * @param ctx the parse tree
	 */
	exitFieldName?: (ctx: FieldNameContext) => void;
}

