// Generated from ./antlr4/StructParser.g4 by ANTLR 4.9.0-SNAPSHOT


import { ATN } from "antlr4ts/atn/ATN";
import { ATNDeserializer } from "antlr4ts/atn/ATNDeserializer";
import { FailedPredicateException } from "antlr4ts/FailedPredicateException";
import { NotNull } from "antlr4ts/Decorators";
import { NoViableAltException } from "antlr4ts/NoViableAltException";
import { Override } from "antlr4ts/Decorators";
import { Parser } from "antlr4ts/Parser";
import { ParserRuleContext } from "antlr4ts/ParserRuleContext";
import { ParserATNSimulator } from "antlr4ts/atn/ParserATNSimulator";
import { ParseTreeListener } from "antlr4ts/tree/ParseTreeListener";
import { ParseTreeVisitor } from "antlr4ts/tree/ParseTreeVisitor";
import { RecognitionException } from "antlr4ts/RecognitionException";
import { RuleContext } from "antlr4ts/RuleContext";
//import { RuleVersion } from "antlr4ts/RuleVersion";
import { TerminalNode } from "antlr4ts/tree/TerminalNode";
import { Token } from "antlr4ts/Token";
import { TokenStream } from "antlr4ts/TokenStream";
import { Vocabulary } from "antlr4ts/Vocabulary";
import { VocabularyImpl } from "antlr4ts/VocabularyImpl";

import * as Utils from "antlr4ts/misc/Utils";

import { StructParserListener } from "./StructParserListener";
import { StructParserVisitor } from "./StructParserVisitor";


export class StructParserParser extends Parser {
	public static readonly T__0 = 1;
	public static readonly T__1 = 2;
	public static readonly T__2 = 3;
	public static readonly T__3 = 4;
	public static readonly T__4 = 5;
	public static readonly T__5 = 6;
	public static readonly T__6 = 7;
	public static readonly Identifier = 8;
	public static readonly IntegerLiteral = 9;
	public static readonly LineComment = 10;
	public static readonly BlockComment = 11;
	public static readonly Whitespace = 12;
	public static readonly PreprocessorDirective = 13;
	public static readonly AnyOther = 14;
	public static readonly RULE_program = 0;
	public static readonly RULE_item = 1;
	public static readonly RULE_otherContent = 2;
	public static readonly RULE_declaration = 3;
	public static readonly RULE_structDeclaration = 4;
	public static readonly RULE_unionDeclaration = 5;
	public static readonly RULE_typedefDeclaration = 6;
	public static readonly RULE_typeDefinition = 7;
	public static readonly RULE_fieldList = 8;
	public static readonly RULE_field = 9;
	public static readonly RULE_otherField = 10;
	public static readonly RULE_typeSpecifier = 11;
	public static readonly RULE_fieldName = 12;
	// tslint:disable:no-trailing-whitespace
	public static readonly ruleNames: string[] = [
		"program", "item", "otherContent", "declaration", "structDeclaration", 
		"unionDeclaration", "typedefDeclaration", "typeDefinition", "fieldList", 
		"field", "otherField", "typeSpecifier", "fieldName",
	];

	private static readonly _LITERAL_NAMES: Array<string | undefined> = [
		undefined, "'struct'", "'union'", "'typedef'", "'{'", "'}'", "';'", "'uint'",
	];
	private static readonly _SYMBOLIC_NAMES: Array<string | undefined> = [
		undefined, undefined, undefined, undefined, undefined, undefined, undefined, 
		undefined, "Identifier", "IntegerLiteral", "LineComment", "BlockComment", 
		"Whitespace", "PreprocessorDirective", "AnyOther",
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(StructParserParser._LITERAL_NAMES, StructParserParser._SYMBOLIC_NAMES, []);

	// @Override
	// @NotNull
	public get vocabulary(): Vocabulary {
		return StructParserParser.VOCABULARY;
	}
	// tslint:enable:no-trailing-whitespace

	// @Override
	public get grammarFileName(): string { return "StructParser.g4"; }

	// @Override
	public get ruleNames(): string[] { return StructParserParser.ruleNames; }

	// @Override
	public get serializedATN(): string { return StructParserParser._serializedATN; }

	protected createFailedPredicateException(predicate?: string, message?: string): FailedPredicateException {
		return new FailedPredicateException(this, predicate, message);
	}

	constructor(input: TokenStream) {
		super(input);
		this._interp = new ParserATNSimulator(StructParserParser._ATN, this);
	}
	// @RuleVersion(0)
	public program(): ProgramContext {
		let _localctx: ProgramContext = new ProgramContext(this._ctx, this.state);
		this.enterRule(_localctx, 0, StructParserParser.RULE_program);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 29;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			while ((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << StructParserParser.T__0) | (1 << StructParserParser.T__1) | (1 << StructParserParser.T__2) | (1 << StructParserParser.T__3) | (1 << StructParserParser.T__4) | (1 << StructParserParser.T__5) | (1 << StructParserParser.T__6) | (1 << StructParserParser.Identifier) | (1 << StructParserParser.IntegerLiteral) | (1 << StructParserParser.LineComment) | (1 << StructParserParser.BlockComment) | (1 << StructParserParser.Whitespace) | (1 << StructParserParser.PreprocessorDirective) | (1 << StructParserParser.AnyOther))) !== 0)) {
				{
				{
				this.state = 26;
				this.item();
				}
				}
				this.state = 31;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
			}
			this.state = 32;
			this.match(StructParserParser.EOF);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public item(): ItemContext {
		let _localctx: ItemContext = new ItemContext(this._ctx, this.state);
		this.enterRule(_localctx, 2, StructParserParser.RULE_item);
		try {
			this.state = 36;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case StructParserParser.T__0:
			case StructParserParser.T__1:
			case StructParserParser.T__2:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 34;
				this.declaration();
				}
				break;
			case StructParserParser.T__3:
			case StructParserParser.T__4:
			case StructParserParser.T__5:
			case StructParserParser.T__6:
			case StructParserParser.Identifier:
			case StructParserParser.IntegerLiteral:
			case StructParserParser.LineComment:
			case StructParserParser.BlockComment:
			case StructParserParser.Whitespace:
			case StructParserParser.PreprocessorDirective:
			case StructParserParser.AnyOther:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 35;
				this.otherContent();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public otherContent(): OtherContentContext {
		let _localctx: OtherContentContext = new OtherContentContext(this._ctx, this.state);
		this.enterRule(_localctx, 4, StructParserParser.RULE_otherContent);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 39;
			this._errHandler.sync(this);
			_alt = 1;
			do {
				switch (_alt) {
				case 1:
					{
					{
					this.state = 38;
					_la = this._input.LA(1);
					if (_la <= 0 || ((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << StructParserParser.T__0) | (1 << StructParserParser.T__1) | (1 << StructParserParser.T__2))) !== 0))) {
					this._errHandler.recoverInline(this);
					} else {
						if (this._input.LA(1) === Token.EOF) {
							this.matchedEOF = true;
						}

						this._errHandler.reportMatch(this);
						this.consume();
					}
					}
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				this.state = 41;
				this._errHandler.sync(this);
				_alt = this.interpreter.adaptivePredict(this._input, 2, this._ctx);
			} while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public declaration(): DeclarationContext {
		let _localctx: DeclarationContext = new DeclarationContext(this._ctx, this.state);
		this.enterRule(_localctx, 6, StructParserParser.RULE_declaration);
		try {
			this.state = 46;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case StructParserParser.T__0:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 43;
				this.structDeclaration();
				}
				break;
			case StructParserParser.T__1:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 44;
				this.unionDeclaration();
				}
				break;
			case StructParserParser.T__2:
				this.enterOuterAlt(_localctx, 3);
				{
				this.state = 45;
				this.typedefDeclaration();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public structDeclaration(): StructDeclarationContext {
		let _localctx: StructDeclarationContext = new StructDeclarationContext(this._ctx, this.state);
		this.enterRule(_localctx, 8, StructParserParser.RULE_structDeclaration);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 48;
			this.match(StructParserParser.T__0);
			this.state = 50;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la === StructParserParser.Identifier) {
				{
				this.state = 49;
				this.match(StructParserParser.Identifier);
				}
			}

			this.state = 52;
			this.match(StructParserParser.T__3);
			this.state = 53;
			this.fieldList();
			this.state = 54;
			this.match(StructParserParser.T__4);
			this.state = 55;
			this.match(StructParserParser.T__5);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public unionDeclaration(): UnionDeclarationContext {
		let _localctx: UnionDeclarationContext = new UnionDeclarationContext(this._ctx, this.state);
		this.enterRule(_localctx, 10, StructParserParser.RULE_unionDeclaration);
		let _la: number;
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 57;
			this.match(StructParserParser.T__1);
			this.state = 59;
			this._errHandler.sync(this);
			_la = this._input.LA(1);
			if (_la === StructParserParser.Identifier) {
				{
				this.state = 58;
				this.match(StructParserParser.Identifier);
				}
			}

			this.state = 61;
			this.match(StructParserParser.T__3);
			this.state = 62;
			this.fieldList();
			this.state = 63;
			this.match(StructParserParser.T__4);
			this.state = 64;
			this.match(StructParserParser.T__5);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public typedefDeclaration(): TypedefDeclarationContext {
		let _localctx: TypedefDeclarationContext = new TypedefDeclarationContext(this._ctx, this.state);
		this.enterRule(_localctx, 12, StructParserParser.RULE_typedefDeclaration);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 66;
			this.match(StructParserParser.T__2);
			this.state = 67;
			this.typeDefinition();
			this.state = 68;
			this.match(StructParserParser.Identifier);
			this.state = 69;
			this.match(StructParserParser.T__5);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public typeDefinition(): TypeDefinitionContext {
		let _localctx: TypeDefinitionContext = new TypeDefinitionContext(this._ctx, this.state);
		this.enterRule(_localctx, 14, StructParserParser.RULE_typeDefinition);
		try {
			this.state = 82;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case StructParserParser.T__0:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 71;
				this.match(StructParserParser.T__0);
				this.state = 72;
				this.match(StructParserParser.T__3);
				this.state = 73;
				this.fieldList();
				this.state = 74;
				this.match(StructParserParser.T__4);
				}
				break;
			case StructParserParser.T__1:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 76;
				this.match(StructParserParser.T__1);
				this.state = 77;
				this.match(StructParserParser.T__3);
				this.state = 78;
				this.fieldList();
				this.state = 79;
				this.match(StructParserParser.T__4);
				}
				break;
			case StructParserParser.T__6:
			case StructParserParser.Identifier:
				this.enterOuterAlt(_localctx, 3);
				{
				this.state = 81;
				this.typeSpecifier();
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public fieldList(): FieldListContext {
		let _localctx: FieldListContext = new FieldListContext(this._ctx, this.state);
		this.enterRule(_localctx, 16, StructParserParser.RULE_fieldList);
		try {
			let _alt: number;
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 87;
			this._errHandler.sync(this);
			_alt = this.interpreter.adaptivePredict(this._input, 7, this._ctx);
			while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER) {
				if (_alt === 1) {
					{
					{
					this.state = 84;
					this.field();
					}
					}
				}
				this.state = 89;
				this._errHandler.sync(this);
				_alt = this.interpreter.adaptivePredict(this._input, 7, this._ctx);
			}
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public field(): FieldContext {
		let _localctx: FieldContext = new FieldContext(this._ctx, this.state);
		this.enterRule(_localctx, 18, StructParserParser.RULE_field);
		let _la: number;
		try {
			this.state = 127;
			this._errHandler.sync(this);
			switch ( this.interpreter.adaptivePredict(this._input, 10, this._ctx) ) {
			case 1:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 90;
				this.typeSpecifier();
				this.state = 91;
				this.fieldName();
				this.state = 92;
				this.match(StructParserParser.T__5);
				}
				break;

			case 2:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 94;
				this.match(StructParserParser.T__0);
				this.state = 95;
				this.match(StructParserParser.T__3);
				this.state = 96;
				this.fieldList();
				this.state = 97;
				this.match(StructParserParser.T__4);
				this.state = 99;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la === StructParserParser.Identifier) {
					{
					this.state = 98;
					this.fieldName();
					}
				}

				this.state = 101;
				this.match(StructParserParser.T__5);
				}
				break;

			case 3:
				this.enterOuterAlt(_localctx, 3);
				{
				this.state = 103;
				this.match(StructParserParser.T__1);
				this.state = 104;
				this.match(StructParserParser.T__3);
				this.state = 105;
				this.fieldList();
				this.state = 106;
				this.match(StructParserParser.T__4);
				this.state = 108;
				this._errHandler.sync(this);
				_la = this._input.LA(1);
				if (_la === StructParserParser.Identifier) {
					{
					this.state = 107;
					this.fieldName();
					}
				}

				this.state = 110;
				this.match(StructParserParser.T__5);
				}
				break;

			case 4:
				this.enterOuterAlt(_localctx, 4);
				{
				this.state = 112;
				this.match(StructParserParser.Identifier);
				this.state = 113;
				this.fieldName();
				this.state = 114;
				this.match(StructParserParser.T__5);
				}
				break;

			case 5:
				this.enterOuterAlt(_localctx, 5);
				{
				this.state = 116;
				this.match(StructParserParser.T__0);
				this.state = 117;
				this.match(StructParserParser.Identifier);
				this.state = 118;
				this.fieldName();
				this.state = 119;
				this.match(StructParserParser.T__5);
				}
				break;

			case 6:
				this.enterOuterAlt(_localctx, 6);
				{
				this.state = 121;
				this.match(StructParserParser.T__1);
				this.state = 122;
				this.match(StructParserParser.Identifier);
				this.state = 123;
				this.fieldName();
				this.state = 124;
				this.match(StructParserParser.T__5);
				}
				break;

			case 7:
				this.enterOuterAlt(_localctx, 7);
				{
				this.state = 126;
				this.otherField();
				}
				break;
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public otherField(): OtherFieldContext {
		let _localctx: OtherFieldContext = new OtherFieldContext(this._ctx, this.state);
		this.enterRule(_localctx, 20, StructParserParser.RULE_otherField);
		let _la: number;
		try {
			let _alt: number;
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 130;
			this._errHandler.sync(this);
			_alt = 1;
			do {
				switch (_alt) {
				case 1:
					{
					{
					this.state = 129;
					_la = this._input.LA(1);
					if (_la <= 0 || ((((_la) & ~0x1F) === 0 && ((1 << _la) & ((1 << StructParserParser.T__0) | (1 << StructParserParser.T__1) | (1 << StructParserParser.T__2) | (1 << StructParserParser.T__6) | (1 << StructParserParser.Identifier))) !== 0))) {
					this._errHandler.recoverInline(this);
					} else {
						if (this._input.LA(1) === Token.EOF) {
							this.matchedEOF = true;
						}

						this._errHandler.reportMatch(this);
						this.consume();
					}
					}
					}
					break;
				default:
					throw new NoViableAltException(this);
				}
				this.state = 132;
				this._errHandler.sync(this);
				_alt = this.interpreter.adaptivePredict(this._input, 11, this._ctx);
			} while (_alt !== 2 && _alt !== ATN.INVALID_ALT_NUMBER);
			this.state = 134;
			this.match(StructParserParser.T__5);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public typeSpecifier(): TypeSpecifierContext {
		let _localctx: TypeSpecifierContext = new TypeSpecifierContext(this._ctx, this.state);
		this.enterRule(_localctx, 22, StructParserParser.RULE_typeSpecifier);
		try {
			this.state = 139;
			this._errHandler.sync(this);
			switch (this._input.LA(1)) {
			case StructParserParser.T__6:
				this.enterOuterAlt(_localctx, 1);
				{
				this.state = 136;
				this.match(StructParserParser.T__6);
				this.state = 137;
				this.match(StructParserParser.IntegerLiteral);
				}
				break;
			case StructParserParser.Identifier:
				this.enterOuterAlt(_localctx, 2);
				{
				this.state = 138;
				this.match(StructParserParser.Identifier);
				}
				break;
			default:
				throw new NoViableAltException(this);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}
	// @RuleVersion(0)
	public fieldName(): FieldNameContext {
		let _localctx: FieldNameContext = new FieldNameContext(this._ctx, this.state);
		this.enterRule(_localctx, 24, StructParserParser.RULE_fieldName);
		try {
			this.enterOuterAlt(_localctx, 1);
			{
			this.state = 141;
			this.match(StructParserParser.Identifier);
			}
		}
		catch (re) {
			if (re instanceof RecognitionException) {
				_localctx.exception = re;
				this._errHandler.reportError(this, re);
				this._errHandler.recover(this, re);
			} else {
				throw re;
			}
		}
		finally {
			this.exitRule();
		}
		return _localctx;
	}

	public static readonly _serializedATN: string =
		"\x03\uC91D\uCABA\u058D\uAFBA\u4F53\u0607\uEA8B\uC241\x03\x10\x92\x04\x02" +
		"\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04\x07" +
		"\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r\x04" +
		"\x0E\t\x0E\x03\x02\x07\x02\x1E\n\x02\f\x02\x0E\x02!\v\x02\x03\x02\x03" +
		"\x02\x03\x03\x03\x03\x05\x03\'\n\x03\x03\x04\x06\x04*\n\x04\r\x04\x0E" +
		"\x04+\x03\x05\x03\x05\x03\x05\x05\x051\n\x05\x03\x06\x03\x06\x05\x065" +
		"\n\x06\x03\x06\x03\x06\x03\x06\x03\x06\x03\x06\x03\x07\x03\x07\x05\x07" +
		">\n\x07\x03\x07\x03\x07\x03\x07\x03\x07\x03\x07\x03\b\x03\b\x03\b\x03" +
		"\b\x03\b\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x03\t\x03" +
		"\t\x05\tU\n\t\x03\n\x07\nX\n\n\f\n\x0E\n[\v\n\x03\v\x03\v\x03\v\x03\v" +
		"\x03\v\x03\v\x03\v\x03\v\x03\v\x05\vf\n\v\x03\v\x03\v\x03\v\x03\v\x03" +
		"\v\x03\v\x03\v\x05\vo\n\v\x03\v\x03\v\x03\v\x03\v\x03\v\x03\v\x03\v\x03" +
		"\v\x03\v\x03\v\x03\v\x03\v\x03\v\x03\v\x03\v\x03\v\x03\v\x05\v\x82\n\v" +
		"\x03\f\x06\f\x85\n\f\r\f\x0E\f\x86\x03\f\x03\f\x03\r\x03\r\x03\r\x05\r" +
		"\x8E\n\r\x03\x0E\x03\x0E\x03\x0E\x02\x02\x02\x0F\x02\x02\x04\x02\x06\x02" +
		"\b\x02\n\x02\f\x02\x0E\x02\x10\x02\x12\x02\x14\x02\x16\x02\x18\x02\x1A" +
		"\x02\x02\x04\x03\x02\x03\x05\x04\x02\x03\x05\t\n\x02\x98\x02\x1F\x03\x02" +
		"\x02\x02\x04&\x03\x02\x02\x02\x06)\x03\x02\x02\x02\b0\x03\x02\x02\x02" +
		"\n2\x03\x02\x02\x02\f;\x03\x02\x02\x02\x0ED\x03\x02\x02\x02\x10T\x03\x02" +
		"\x02\x02\x12Y\x03\x02\x02\x02\x14\x81\x03\x02\x02\x02\x16\x84\x03\x02" +
		"\x02\x02\x18\x8D\x03\x02\x02\x02\x1A\x8F\x03\x02\x02\x02\x1C\x1E\x05\x04" +
		"\x03\x02\x1D\x1C\x03\x02\x02\x02\x1E!\x03\x02\x02\x02\x1F\x1D\x03\x02" +
		"\x02\x02\x1F \x03\x02\x02\x02 \"\x03\x02\x02\x02!\x1F\x03\x02\x02\x02" +
		"\"#\x07\x02\x02\x03#\x03\x03\x02\x02\x02$\'\x05\b\x05\x02%\'\x05\x06\x04" +
		"\x02&$\x03\x02\x02\x02&%\x03\x02\x02\x02\'\x05\x03\x02\x02\x02(*\n\x02" +
		"\x02\x02)(\x03\x02\x02\x02*+\x03\x02\x02\x02+)\x03\x02\x02\x02+,\x03\x02" +
		"\x02\x02,\x07\x03\x02\x02\x02-1\x05\n\x06\x02.1\x05\f\x07\x02/1\x05\x0E" +
		"\b\x020-\x03\x02\x02\x020.\x03\x02\x02\x020/\x03\x02\x02\x021\t\x03\x02" +
		"\x02\x0224\x07\x03\x02\x0235\x07\n\x02\x0243\x03\x02\x02\x0245\x03\x02" +
		"\x02\x0256\x03\x02\x02\x0267\x07\x06\x02\x0278\x05\x12\n\x0289\x07\x07" +
		"\x02\x029:\x07\b\x02\x02:\v\x03\x02\x02\x02;=\x07\x04\x02\x02<>\x07\n" +
		"\x02\x02=<\x03\x02\x02\x02=>\x03\x02\x02\x02>?\x03\x02\x02\x02?@\x07\x06" +
		"\x02\x02@A\x05\x12\n\x02AB\x07\x07\x02\x02BC\x07\b\x02\x02C\r\x03\x02" +
		"\x02\x02DE\x07\x05\x02\x02EF\x05\x10\t\x02FG\x07\n\x02\x02GH\x07\b\x02" +
		"\x02H\x0F\x03\x02\x02\x02IJ\x07\x03\x02\x02JK\x07\x06\x02\x02KL\x05\x12" +
		"\n\x02LM\x07\x07\x02\x02MU\x03\x02\x02\x02NO\x07\x04\x02\x02OP\x07\x06" +
		"\x02\x02PQ\x05\x12\n\x02QR\x07\x07\x02\x02RU\x03\x02\x02\x02SU\x05\x18" +
		"\r\x02TI\x03\x02\x02\x02TN\x03\x02\x02\x02TS\x03\x02\x02\x02U\x11\x03" +
		"\x02\x02\x02VX\x05\x14\v\x02WV\x03\x02\x02\x02X[\x03\x02\x02\x02YW\x03" +
		"\x02\x02\x02YZ\x03\x02\x02\x02Z\x13\x03\x02\x02\x02[Y\x03\x02\x02\x02" +
		"\\]\x05\x18\r\x02]^\x05\x1A\x0E\x02^_\x07\b\x02\x02_\x82\x03\x02\x02\x02" +
		"`a\x07\x03\x02\x02ab\x07\x06\x02\x02bc\x05\x12\n\x02ce\x07\x07\x02\x02" +
		"df\x05\x1A\x0E\x02ed\x03\x02\x02\x02ef\x03\x02\x02\x02fg\x03\x02\x02\x02" +
		"gh\x07\b\x02\x02h\x82\x03\x02\x02\x02ij\x07\x04\x02\x02jk\x07\x06\x02" +
		"\x02kl\x05\x12\n\x02ln\x07\x07\x02\x02mo\x05\x1A\x0E\x02nm\x03\x02\x02" +
		"\x02no\x03\x02\x02\x02op\x03\x02\x02\x02pq\x07\b\x02\x02q\x82\x03\x02" +
		"\x02\x02rs\x07\n\x02\x02st\x05\x1A\x0E\x02tu\x07\b\x02\x02u\x82\x03\x02" +
		"\x02\x02vw\x07\x03\x02\x02wx\x07\n\x02\x02xy\x05\x1A\x0E\x02yz\x07\b\x02" +
		"\x02z\x82\x03\x02\x02\x02{|\x07\x04\x02\x02|}\x07\n\x02\x02}~\x05\x1A" +
		"\x0E\x02~\x7F\x07\b\x02\x02\x7F\x82\x03\x02\x02\x02\x80\x82\x05\x16\f" +
		"\x02\x81\\\x03\x02\x02\x02\x81`\x03\x02\x02\x02\x81i\x03\x02\x02\x02\x81" +
		"r\x03\x02\x02\x02\x81v\x03\x02\x02\x02\x81{\x03\x02\x02\x02\x81\x80\x03" +
		"\x02\x02\x02\x82\x15\x03\x02\x02\x02\x83\x85\n\x03\x02\x02\x84\x83\x03" +
		"\x02\x02\x02\x85\x86\x03\x02\x02\x02\x86\x84\x03\x02\x02\x02\x86\x87\x03" +
		"\x02\x02\x02\x87\x88\x03\x02\x02\x02\x88\x89\x07\b\x02\x02\x89\x17\x03" +
		"\x02\x02\x02\x8A\x8B\x07\t\x02\x02\x8B\x8E\x07\v\x02\x02\x8C\x8E\x07\n" +
		"\x02\x02\x8D\x8A\x03\x02\x02\x02\x8D\x8C\x03\x02\x02\x02\x8E\x19\x03\x02" +
		"\x02\x02\x8F\x90\x07\n\x02\x02\x90\x1B\x03\x02\x02\x02\x0F\x1F&+04=TY" +
		"en\x81\x86\x8D";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!StructParserParser.__ATN) {
			StructParserParser.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(StructParserParser._serializedATN));
		}

		return StructParserParser.__ATN;
	}

}

export class ProgramContext extends ParserRuleContext {
	public EOF(): TerminalNode { return this.getToken(StructParserParser.EOF, 0); }
	public item(): ItemContext[];
	public item(i: number): ItemContext;
	public item(i?: number): ItemContext | ItemContext[] {
		if (i === undefined) {
			return this.getRuleContexts(ItemContext);
		} else {
			return this.getRuleContext(i, ItemContext);
		}
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_program; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterProgram) {
			listener.enterProgram(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitProgram) {
			listener.exitProgram(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitProgram) {
			return visitor.visitProgram(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class ItemContext extends ParserRuleContext {
	public declaration(): DeclarationContext | undefined {
		return this.tryGetRuleContext(0, DeclarationContext);
	}
	public otherContent(): OtherContentContext | undefined {
		return this.tryGetRuleContext(0, OtherContentContext);
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_item; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterItem) {
			listener.enterItem(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitItem) {
			listener.exitItem(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitItem) {
			return visitor.visitItem(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class OtherContentContext extends ParserRuleContext {
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_otherContent; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterOtherContent) {
			listener.enterOtherContent(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitOtherContent) {
			listener.exitOtherContent(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitOtherContent) {
			return visitor.visitOtherContent(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class DeclarationContext extends ParserRuleContext {
	public structDeclaration(): StructDeclarationContext | undefined {
		return this.tryGetRuleContext(0, StructDeclarationContext);
	}
	public unionDeclaration(): UnionDeclarationContext | undefined {
		return this.tryGetRuleContext(0, UnionDeclarationContext);
	}
	public typedefDeclaration(): TypedefDeclarationContext | undefined {
		return this.tryGetRuleContext(0, TypedefDeclarationContext);
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_declaration; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterDeclaration) {
			listener.enterDeclaration(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitDeclaration) {
			listener.exitDeclaration(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitDeclaration) {
			return visitor.visitDeclaration(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class StructDeclarationContext extends ParserRuleContext {
	public fieldList(): FieldListContext {
		return this.getRuleContext(0, FieldListContext);
	}
	public Identifier(): TerminalNode | undefined { return this.tryGetToken(StructParserParser.Identifier, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_structDeclaration; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterStructDeclaration) {
			listener.enterStructDeclaration(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitStructDeclaration) {
			listener.exitStructDeclaration(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitStructDeclaration) {
			return visitor.visitStructDeclaration(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class UnionDeclarationContext extends ParserRuleContext {
	public fieldList(): FieldListContext {
		return this.getRuleContext(0, FieldListContext);
	}
	public Identifier(): TerminalNode | undefined { return this.tryGetToken(StructParserParser.Identifier, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_unionDeclaration; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterUnionDeclaration) {
			listener.enterUnionDeclaration(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitUnionDeclaration) {
			listener.exitUnionDeclaration(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitUnionDeclaration) {
			return visitor.visitUnionDeclaration(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class TypedefDeclarationContext extends ParserRuleContext {
	public typeDefinition(): TypeDefinitionContext {
		return this.getRuleContext(0, TypeDefinitionContext);
	}
	public Identifier(): TerminalNode { return this.getToken(StructParserParser.Identifier, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_typedefDeclaration; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterTypedefDeclaration) {
			listener.enterTypedefDeclaration(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitTypedefDeclaration) {
			listener.exitTypedefDeclaration(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitTypedefDeclaration) {
			return visitor.visitTypedefDeclaration(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class TypeDefinitionContext extends ParserRuleContext {
	public fieldList(): FieldListContext | undefined {
		return this.tryGetRuleContext(0, FieldListContext);
	}
	public typeSpecifier(): TypeSpecifierContext | undefined {
		return this.tryGetRuleContext(0, TypeSpecifierContext);
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_typeDefinition; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterTypeDefinition) {
			listener.enterTypeDefinition(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitTypeDefinition) {
			listener.exitTypeDefinition(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitTypeDefinition) {
			return visitor.visitTypeDefinition(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class FieldListContext extends ParserRuleContext {
	public field(): FieldContext[];
	public field(i: number): FieldContext;
	public field(i?: number): FieldContext | FieldContext[] {
		if (i === undefined) {
			return this.getRuleContexts(FieldContext);
		} else {
			return this.getRuleContext(i, FieldContext);
		}
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_fieldList; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterFieldList) {
			listener.enterFieldList(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitFieldList) {
			listener.exitFieldList(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitFieldList) {
			return visitor.visitFieldList(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class FieldContext extends ParserRuleContext {
	public typeSpecifier(): TypeSpecifierContext | undefined {
		return this.tryGetRuleContext(0, TypeSpecifierContext);
	}
	public fieldName(): FieldNameContext | undefined {
		return this.tryGetRuleContext(0, FieldNameContext);
	}
	public fieldList(): FieldListContext | undefined {
		return this.tryGetRuleContext(0, FieldListContext);
	}
	public Identifier(): TerminalNode | undefined { return this.tryGetToken(StructParserParser.Identifier, 0); }
	public otherField(): OtherFieldContext | undefined {
		return this.tryGetRuleContext(0, OtherFieldContext);
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_field; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterField) {
			listener.enterField(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitField) {
			listener.exitField(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitField) {
			return visitor.visitField(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class OtherFieldContext extends ParserRuleContext {
	public Identifier(): TerminalNode[];
	public Identifier(i: number): TerminalNode;
	public Identifier(i?: number): TerminalNode | TerminalNode[] {
		if (i === undefined) {
			return this.getTokens(StructParserParser.Identifier);
		} else {
			return this.getToken(StructParserParser.Identifier, i);
		}
	}
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_otherField; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterOtherField) {
			listener.enterOtherField(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitOtherField) {
			listener.exitOtherField(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitOtherField) {
			return visitor.visitOtherField(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class TypeSpecifierContext extends ParserRuleContext {
	public IntegerLiteral(): TerminalNode | undefined { return this.tryGetToken(StructParserParser.IntegerLiteral, 0); }
	public Identifier(): TerminalNode | undefined { return this.tryGetToken(StructParserParser.Identifier, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_typeSpecifier; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterTypeSpecifier) {
			listener.enterTypeSpecifier(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitTypeSpecifier) {
			listener.exitTypeSpecifier(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitTypeSpecifier) {
			return visitor.visitTypeSpecifier(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


export class FieldNameContext extends ParserRuleContext {
	public Identifier(): TerminalNode { return this.getToken(StructParserParser.Identifier, 0); }
	constructor(parent: ParserRuleContext | undefined, invokingState: number) {
		super(parent, invokingState);
	}
	// @Override
	public get ruleIndex(): number { return StructParserParser.RULE_fieldName; }
	// @Override
	public enterRule(listener: StructParserListener): void {
		if (listener.enterFieldName) {
			listener.enterFieldName(this);
		}
	}
	// @Override
	public exitRule(listener: StructParserListener): void {
		if (listener.exitFieldName) {
			listener.exitFieldName(this);
		}
	}
	// @Override
	public accept<Result>(visitor: StructParserVisitor<Result>): Result {
		if (visitor.visitFieldName) {
			return visitor.visitFieldName(this);
		} else {
			return visitor.visitChildren(this);
		}
	}
}


