#!/usr/bin/env node
'use strict';

import fs from 'fs';
import path from 'path';
import * as prettier from 'prettier';
import ts from 'typescript';

import { Closure, ClosureTypes, OutputModuleDefinition } from './types';

const directoryPath = process.cwd();

function maybeUnwrapSwiftArray(type: string) {
  const isArray = type.startsWith('[') && type.endsWith(']');
  if (!isArray) {
    return type;
  }
  const innerType = type.substring(1, type.length - 1);
  return innerType;
}

function isSwiftArray(type: string) {
  return type.startsWith('[') && type.endsWith(']');
}

function mapSwiftTypeToTsType(
  type: string
): ts.KeywordTypeNode | ts.TypeReferenceNode | ts.ArrayTypeNode {
  if (!type) {
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword);
  }
  if (isSwiftArray(type)) {
    return ts.factory.createArrayTypeNode(mapSwiftTypeToTsType(maybeUnwrapSwiftArray(type)));
  }
  switch (type) {
    case 'unknown':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
    case 'String':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
    case 'Bool':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
    case 'Int':
    case 'Float':
    case 'Double':
      return ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
    default:
      return ts.factory.createTypeReferenceNode(type);
  }
}

function getMockReturnStatements(
  tsReturnType: ts.KeywordTypeNode | ts.TypeReferenceNode | ts.ArrayTypeNode
) {
  if (!tsReturnType) {
    return [];
  }
  switch (tsReturnType.kind) {
    case ts.SyntaxKind.AnyKeyword:
      return [ts.factory.createReturnStatement(ts.factory.createNull())];
    case ts.SyntaxKind.StringKeyword:
      return [ts.factory.createReturnStatement(ts.factory.createStringLiteral(''))];
    case ts.SyntaxKind.BooleanKeyword:
      return [ts.factory.createReturnStatement(ts.factory.createFalse())];
    case ts.SyntaxKind.NumberKeyword:
      return [ts.factory.createReturnStatement(ts.factory.createNumericLiteral('0'))];
    case ts.SyntaxKind.VoidKeyword:
      return [];
    case ts.SyntaxKind.ArrayType:
      return [ts.factory.createReturnStatement(ts.factory.createArrayLiteralExpression())];
  }
  return [];
}

function wrapWithAsync(tsType: ts.TypeNode) {
  return ts.factory.createTypeReferenceNode('Promise', [tsType]);
}

function getMockedFunctions(functions: Closure[], async = false) {
  return functions.map((fnStructure) => {
    const name = ts.factory.createIdentifier(fnStructure.name);
    const returnType = mapSwiftTypeToTsType(fnStructure.types?.returnType);
    const func = ts.factory.createFunctionDeclaration(
      [
        ts.factory.createToken(ts.SyntaxKind.ExportKeyword),
        async ? ts.factory.createToken(ts.SyntaxKind.AsyncKeyword) : undefined,
      ].filter((f) => !!f) as ts.ModifierToken<any>[],
      undefined,
      name,
      undefined,
      fnStructure?.types?.parameters.map((p) =>
        ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          p.name,
          undefined,
          mapSwiftTypeToTsType(p.typename),
          undefined
        )
      ) ?? [],
      async ? wrapWithAsync(returnType) : returnType,
      ts.factory.createBlock(getMockReturnStatements(returnType), true)
    );
    return func;
  });
}

function getTypesToMock(module: OutputModuleDefinition) {
  const foundTypes: string[] = [];

  Object.values(module)
    .flatMap((t) => (Array.isArray(t) ? t?.map((t2) => (t2 as Closure)?.types) : [] ?? []))
    .forEach((types: ClosureTypes | null) => {
      types?.parameters.forEach(({ typename }) => {
        foundTypes.push(maybeUnwrapSwiftArray(typename));
      });
      types?.returnType && foundTypes.push(maybeUnwrapSwiftArray(types.returnType));
    });
  return new Set(
    foundTypes.filter((ft) => mapSwiftTypeToTsType(ft).kind === ts.SyntaxKind.TypeReference)
  );
}

function getMockedTypes(types: Set<string>) {
  return Array.from(types).map((type) => {
    const name = ts.factory.createIdentifier(type);
    const typeAlias = ts.factory.createTypeAliasDeclaration(
      [ts.factory.createToken(ts.SyntaxKind.ExportKeyword)],
      name,
      undefined,
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
    );
    return typeAlias;
  });
}

function getMockForModule(module: OutputModuleDefinition) {
  return ([] as (ts.TypeAliasDeclaration | ts.FunctionDeclaration)[]).concat(
    getMockedTypes(getTypesToMock(module)),
    getMockedFunctions(module.functions),
    getMockedFunctions(module.asyncFunctions, true)
  );
}

export async function generateMocks(modules: OutputModuleDefinition[]) {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  for (const m of modules) {
    const resultFile = ts.createSourceFile(
      m.name + '.ts',
      '',
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX
    );
    fs.mkdirSync(path.join(directoryPath, 'mocks'), { recursive: true });
    const filePath = path.join(directoryPath, 'mocks', m.name + '.ts');
    // get ts nodearray from getMockForModule(m) array
    const mock = ts.factory.createNodeArray(getMockForModule(m));
    const printedTs = printer.printList(ts.ListFormat.MultiLine, mock, resultFile);
    const compiledJs = ts.transpileModule(printedTs, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText;
    const prettyJs = await prettier.format(compiledJs, {
      parser: 'babel',
      tabWidth: 2,
      singleQuote: true,
    });
    fs.writeFileSync(filePath, prettyJs);
  }
}
