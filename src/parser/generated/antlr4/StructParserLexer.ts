// Generated from ./antlr4/StructParser.g4 by ANTLR 4.9.0-SNAPSHOT


import { ATN } from "antlr4ts/atn/ATN";
import { ATNDeserializer } from "antlr4ts/atn/ATNDeserializer";
import { CharStream } from "antlr4ts/CharStream";
import { Lexer } from "antlr4ts/Lexer";
import { LexerATNSimulator } from "antlr4ts/atn/LexerATNSimulator";
import { NotNull } from "antlr4ts/Decorators";
import { Override } from "antlr4ts/Decorators";
import { RuleContext } from "antlr4ts/RuleContext";
import { Vocabulary } from "antlr4ts/Vocabulary";
import { VocabularyImpl } from "antlr4ts/VocabularyImpl";

import * as Utils from "antlr4ts/misc/Utils";


export class StructParserLexer extends Lexer {
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

	// tslint:disable:no-trailing-whitespace
	public static readonly channelNames: string[] = [
		"DEFAULT_TOKEN_CHANNEL", "HIDDEN",
	];

	// tslint:disable:no-trailing-whitespace
	public static readonly modeNames: string[] = [
		"DEFAULT_MODE",
	];

	public static readonly ruleNames: string[] = [
		"T__0", "T__1", "T__2", "T__3", "T__4", "T__5", "T__6", "Identifier", 
		"IntegerLiteral", "LineComment", "BlockComment", "Whitespace", "PreprocessorDirective", 
		"AnyOther",
	];

	private static readonly _LITERAL_NAMES: Array<string | undefined> = [
		undefined, "'struct'", "'union'", "'typedef'", "'{'", "'}'", "';'", "'uint'",
	];
	private static readonly _SYMBOLIC_NAMES: Array<string | undefined> = [
		undefined, undefined, undefined, undefined, undefined, undefined, undefined, 
		undefined, "Identifier", "IntegerLiteral", "LineComment", "BlockComment", 
		"Whitespace", "PreprocessorDirective", "AnyOther",
	];
	public static readonly VOCABULARY: Vocabulary = new VocabularyImpl(StructParserLexer._LITERAL_NAMES, StructParserLexer._SYMBOLIC_NAMES, []);

	// @Override
	// @NotNull
	public get vocabulary(): Vocabulary {
		return StructParserLexer.VOCABULARY;
	}
	// tslint:enable:no-trailing-whitespace


	constructor(input: CharStream) {
		super(input);
		this._interp = new LexerATNSimulator(StructParserLexer._ATN, this);
	}

	// @Override
	public get grammarFileName(): string { return "StructParser.g4"; }

	// @Override
	public get ruleNames(): string[] { return StructParserLexer.ruleNames; }

	// @Override
	public get serializedATN(): string { return StructParserLexer._serializedATN; }

	// @Override
	public get channelNames(): string[] { return StructParserLexer.channelNames; }

	// @Override
	public get modeNames(): string[] { return StructParserLexer.modeNames; }

	public static readonly _serializedATN: string =
		"\x03\uC91D\uCABA\u058D\uAFBA\u4F53\u0607\uEA8B\uC241\x02\x10x\b\x01\x04" +
		"\x02\t\x02\x04\x03\t\x03\x04\x04\t\x04\x04\x05\t\x05\x04\x06\t\x06\x04" +
		"\x07\t\x07\x04\b\t\b\x04\t\t\t\x04\n\t\n\x04\v\t\v\x04\f\t\f\x04\r\t\r" +
		"\x04\x0E\t\x0E\x04\x0F\t\x0F\x03\x02\x03\x02\x03\x02\x03\x02\x03\x02\x03" +
		"\x02\x03\x02\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x03\x04\x03" +
		"\x04\x03\x04\x03\x04\x03\x04\x03\x04\x03\x04\x03\x04\x03\x05\x03\x05\x03" +
		"\x06\x03\x06\x03\x07\x03\x07\x03\b\x03\b\x03\b\x03\b\x03\b\x03\t\x03\t" +
		"\x07\tB\n\t\f\t\x0E\tE\v\t\x03\n\x06\nH\n\n\r\n\x0E\nI\x03\v\x03\v\x03" +
		"\v\x03\v\x07\vP\n\v\f\v\x0E\vS\v\v\x03\v\x03\v\x03\f\x03\f\x03\f\x03\f" +
		"\x07\f[\n\f\f\f\x0E\f^\v\f\x03\f\x03\f\x03\f\x03\f\x03\f\x03\r\x06\rf" +
		"\n\r\r\r\x0E\rg\x03\r\x03\r\x03\x0E\x03\x0E\x07\x0En\n\x0E\f\x0E\x0E\x0E" +
		"q\v\x0E\x03\x0E\x03\x0E\x03\x0F\x03\x0F\x03\x0F\x03\x0F\x03\\\x02\x02" +
		"\x10\x03\x02\x03\x05\x02\x04\x07\x02\x05\t\x02\x06\v\x02\x07\r\x02\b\x0F" +
		"\x02\t\x11\x02\n\x13\x02\v\x15\x02\f\x17\x02\r\x19\x02\x0E\x1B\x02\x0F" +
		"\x1D\x02\x10\x03\x02\x07\x05\x02C\\aac|\x06\x022;C\\aac|\x03\x022;\x04" +
		"\x02\f\f\x0F\x0F\x05\x02\v\f\x0F\x0F\"\"\x02}\x02\x03\x03\x02\x02\x02" +
		"\x02\x05\x03\x02\x02\x02\x02\x07\x03\x02\x02\x02\x02\t\x03\x02\x02\x02" +
		"\x02\v\x03\x02\x02\x02\x02\r\x03\x02\x02\x02\x02\x0F\x03\x02\x02\x02\x02" +
		"\x11\x03\x02\x02\x02\x02\x13\x03\x02\x02\x02\x02\x15\x03\x02\x02\x02\x02" +
		"\x17\x03\x02\x02\x02\x02\x19\x03\x02\x02\x02\x02\x1B\x03\x02\x02\x02\x02" +
		"\x1D\x03\x02\x02\x02\x03\x1F\x03\x02\x02\x02\x05&\x03\x02\x02\x02\x07" +
		",\x03\x02\x02\x02\t4\x03\x02\x02\x02\v6\x03\x02\x02\x02\r8\x03\x02\x02" +
		"\x02\x0F:\x03\x02\x02\x02\x11?\x03\x02\x02\x02\x13G\x03\x02\x02\x02\x15" +
		"K\x03\x02\x02\x02\x17V\x03\x02\x02\x02\x19e\x03\x02\x02\x02\x1Bk\x03\x02" +
		"\x02\x02\x1Dt\x03\x02\x02\x02\x1F \x07u\x02\x02 !\x07v\x02\x02!\"\x07" +
		"t\x02\x02\"#\x07w\x02\x02#$\x07e\x02\x02$%\x07v\x02\x02%\x04\x03\x02\x02" +
		"\x02&\'\x07w\x02\x02\'(\x07p\x02\x02()\x07k\x02\x02)*\x07q\x02\x02*+\x07" +
		"p\x02\x02+\x06\x03\x02\x02\x02,-\x07v\x02\x02-.\x07{\x02\x02./\x07r\x02" +
		"\x02/0\x07g\x02\x0201\x07f\x02\x0212\x07g\x02\x0223\x07h\x02\x023\b\x03" +
		"\x02\x02\x0245\x07}\x02\x025\n\x03\x02\x02\x0267\x07\x7F\x02\x027\f\x03" +
		"\x02\x02\x0289\x07=\x02\x029\x0E\x03\x02\x02\x02:;\x07w\x02\x02;<\x07" +
		"k\x02\x02<=\x07p\x02\x02=>\x07v\x02\x02>\x10\x03\x02\x02\x02?C\t\x02\x02" +
		"\x02@B\t\x03\x02\x02A@\x03\x02\x02\x02BE\x03\x02\x02\x02CA\x03\x02\x02" +
		"\x02CD\x03\x02\x02\x02D\x12\x03\x02\x02\x02EC\x03\x02\x02\x02FH\t\x04" +
		"\x02\x02GF\x03\x02\x02\x02HI\x03\x02\x02\x02IG\x03\x02\x02\x02IJ\x03\x02" +
		"\x02\x02J\x14\x03\x02\x02\x02KL\x071\x02\x02LM\x071\x02\x02MQ\x03\x02" +
		"\x02\x02NP\n\x05\x02\x02ON\x03\x02\x02\x02PS\x03\x02\x02\x02QO\x03\x02" +
		"\x02\x02QR\x03\x02\x02\x02RT\x03\x02\x02\x02SQ\x03\x02\x02\x02TU\b\v\x02" +
		"\x02U\x16\x03\x02\x02\x02VW\x071\x02\x02WX\x07,\x02\x02X\\\x03\x02\x02" +
		"\x02Y[\v\x02\x02\x02ZY\x03\x02\x02\x02[^\x03\x02\x02\x02\\]\x03\x02\x02" +
		"\x02\\Z\x03\x02\x02\x02]_\x03\x02\x02\x02^\\\x03\x02\x02\x02_`\x07,\x02" +
		"\x02`a\x071\x02\x02ab\x03\x02\x02\x02bc\b\f\x02\x02c\x18\x03\x02\x02\x02" +
		"df\t\x06\x02\x02ed\x03\x02\x02\x02fg\x03\x02\x02\x02ge\x03\x02\x02\x02" +
		"gh\x03\x02\x02\x02hi\x03\x02\x02\x02ij\b\r\x02\x02j\x1A\x03\x02\x02\x02" +
		"ko\x07%\x02\x02ln\n\x05\x02\x02ml\x03\x02\x02\x02nq\x03\x02\x02\x02om" +
		"\x03\x02\x02\x02op\x03\x02\x02\x02pr\x03\x02\x02\x02qo\x03\x02\x02\x02" +
		"rs\b\x0E\x02\x02s\x1C\x03\x02\x02\x02tu\v\x02\x02\x02uv\x03\x02\x02\x02" +
		"vw\b\x0F\x02\x02w\x1E\x03\x02\x02\x02\t\x02CIQ\\go\x03\b\x02\x02";
	public static __ATN: ATN;
	public static get _ATN(): ATN {
		if (!StructParserLexer.__ATN) {
			StructParserLexer.__ATN = new ATNDeserializer().deserialize(Utils.toCharArray(StructParserLexer._serializedATN));
		}

		return StructParserLexer.__ATN;
	}

}

