import ts, { NodeFlags, PropertySignature, TypeNode } from "typescript";
import {
  ColumnDefinition,
  ColumnTypeDefinition,
  EnumStub,
  FunctionDefinition,
  FunctionParameterDefinition,
  FunctionReturnTypeDefinition,
  RelationDefinition,
  SchemaDefinition,
} from "introspeql";
import synchronizedPrettier from "@prettier/sync";

interface Import {
  value: string;
  isTypeImport: boolean;
}

type TsType = string | EnumStub;

type OptionalParameterPermutation = Omit<
  FunctionParameterDefinition,
  "isOptional"
>;

export class KyselyTypeGenerator {
  private static readonly KYSELY_GENERATED_TYPE = "Generated";
  private static readonly KYSELY_GENERATED_ALWAYS_TYPE = "GeneratedAlways";

  private kyselyImports: Import[] = [
    {
      value: "sql",
      isTypeImport: false,
    },
    {
      value: "Expression",
      isTypeImport: true,
    },
    {
      value: "RawBuilder",
      isTypeImport: true,
    },
  ];

  constructor(private schemaDefinitions: SchemaDefinition[]) {}

  public genTypes(customHeader?: string): string {
    const db = this.genDBInterfaceNode();
    const fnNodes = this.genFunctionTypeNodes();
    const importStatements = this.genImportStatements();

    const printer = ts.createPrinter();

    const kyselyImports = printer.printFile(
      ts.factory.createSourceFile(
        [importStatements],
        ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
        NodeFlags.None,
      ),
    );

    const statements = [db, ...fnNodes].map((statement) => {
      return printer.printFile(
        ts.factory.createSourceFile(
          [statement],
          ts.factory.createToken(ts.SyntaxKind.EndOfFileToken),
          NodeFlags.None,
        ),
      );
    });

    let src = [kyselyImports];

    if (customHeader) {
      src.push(customHeader.trim());
    }

    src = [...src, ...statements];
    const output = src.join("\n\n");
    return this.formatOutput(output);
  }

  private genDBInterfaceNode() {
    const relationProperties = this.schemaDefinitions.flatMap(
      (schemaDefinition) => {
        return [
          ...schemaDefinition.tableDefinitions,
          ...schemaDefinition.viewDefinitions,
          ...schemaDefinition.materializedViewDefinitions,
        ].map((relationDefinition) =>
          this.createRelationProperty(
            schemaDefinition.pgName,
            relationDefinition,
          ),
        );
      },
    );

    const db = ts.factory.createInterfaceDeclaration(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      "DB",
      undefined,
      undefined,
      relationProperties,
    );

    return db;
  }

  private createRelationProperty(
    schemaName: string,
    relationDefinition: RelationDefinition,
  ) {
    let relationSignature = ts.factory.createPropertySignature(
      undefined,
      ts.factory.createStringLiteral(
        `${schemaName}.${relationDefinition.pgName}`,
        true,
      ),
      undefined,
      ts.factory.createTypeLiteralNode(
        relationDefinition.columns.map((col) =>
          this.createRelationColumnProperty(col),
        ),
      ),
    );

    relationSignature = this.applyTSDocComment(
      relationSignature,
      relationDefinition.tsDocComment,
    );

    return relationSignature;
  }

  private createRelationColumnProperty(columnDefinition: ColumnDefinition) {
    let columnSignature = ts.factory.createPropertySignature(
      undefined,
      ts.factory.createStringLiteral(columnDefinition.pgName, true),
      undefined,
      this.createColumnTypeNode(columnDefinition.typeDefinition),
    );

    columnSignature = this.applyTSDocComment(
      columnSignature,
      columnDefinition.tsDocComment,
    );

    return columnSignature;
  }

  private createColumnTypeNode(columnTypeDefinition: ColumnTypeDefinition) {
    let columnType: TypeNode = this.tsTypeToTypeNode(
      columnTypeDefinition.tsType,
    );

    for (let i = 0; i < columnTypeDefinition.numDimensions; i++) {
      columnType = ts.factory.createArrayTypeNode(columnType);
    }

    this.applyNullable(columnType, columnTypeDefinition.isNullable);

    if (columnTypeDefinition.generated === "always") {
      columnType = ts.factory.createTypeReferenceNode(
        KyselyTypeGenerator.KYSELY_GENERATED_ALWAYS_TYPE,
        [columnType],
      );

      if (
        !this.kyselyImports.some(
          (i) => i.value === KyselyTypeGenerator.KYSELY_GENERATED_ALWAYS_TYPE,
        )
      ) {
        this.kyselyImports.push({
          value: KyselyTypeGenerator.KYSELY_GENERATED_ALWAYS_TYPE,
          isTypeImport: true,
        });
      }
    } else if (columnTypeDefinition.generated === "by_default") {
      columnType = ts.factory.createTypeReferenceNode(
        KyselyTypeGenerator.KYSELY_GENERATED_TYPE,
        [columnType],
      );

      if (
        !this.kyselyImports.some(
          (i) => i.value === KyselyTypeGenerator.KYSELY_GENERATED_TYPE,
        )
      ) {
        this.kyselyImports.push({
          value: KyselyTypeGenerator.KYSELY_GENERATED_TYPE,
          isTypeImport: true,
        });
      }
    }

    return columnType;
  }

  private genFunctionTypeNodes() {
    const functionDefinitions = this.schemaDefinitions.flatMap((schema) =>
      schema.functionDefinitions.map((fn) => ({
        pgName: `${schema.pgName}.${fn.pgName}`,
        overloads: this.getOverloads(fn),
      })),
    );

    const pgFnNamesIdentifier = ts.factory.createIdentifier("PgFnNames");

    const pgFnNamesType = ts.factory.createTypeAliasDeclaration(
      undefined,
      pgFnNamesIdentifier,
      undefined,
      functionDefinitions.length > 0
        ? ts.factory.createUnionTypeNode(
            functionDefinitions.map(({ pgName }) =>
              ts.factory.createLiteralTypeNode(
                ts.factory.createStringLiteral(pgName, true),
              ),
            ),
          )
        : ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword),
    );

    const pgFnParamsType = ts.factory.createTypeAliasDeclaration(
      undefined,
      ts.factory.createIdentifier("PgFnParams"),
      [
        ts.factory.createTypeParameterDeclaration(
          undefined,
          ts.factory.createIdentifier("T"),
          ts.factory.createTypeReferenceNode(pgFnNamesIdentifier),
        ),
      ],
      this.buildConditionalChain(
        ts.factory.createTypeReferenceNode("T"),
        functionDefinitions.map(({ pgName, overloads }) => ({
          extendsType: ts.factory.createLiteralTypeNode(
            ts.factory.createStringLiteral(pgName, true),
          ),
          resultType: ts.factory.createUnionTypeNode(
            overloads.map(({ parameterDefinitions }) =>
              ts.factory.createTupleTypeNode(
                parameterDefinitions.map((parameterDefinition) =>
                  this.buildParamTypeNode(parameterDefinition),
                ),
              ),
            ),
          ),
        })),
      ),
    );

    const pgFnReturnTypes = ts.factory.createTypeAliasDeclaration(
      undefined,
      "PgFnReturnTypes",
      [
        ts.factory.createTypeParameterDeclaration(
          undefined,
          ts.factory.createIdentifier("T"),
          ts.factory.createTypeReferenceNode(pgFnNamesIdentifier),
        ),
        ts.factory.createTypeParameterDeclaration(
          undefined,
          ts.factory.createIdentifier("V"),
          ts.factory.createTypeReferenceNode("PgFnParams", [
            ts.factory.createTypeReferenceNode("T"),
          ]),
        ),
      ],
      this.buildConditionalChain(
        ts.factory.createTypeReferenceNode("T"),
        functionDefinitions.map(({ pgName, overloads }) => ({
          extendsType: ts.factory.createLiteralTypeNode(
            ts.factory.createStringLiteral(pgName),
          ),
          resultType: this.buildConditionalChain(
            ts.factory.createTypeReferenceNode("V"),
            overloads.map(({ parameterDefinitions, returnTypeDefinition }) => ({
              extendsType: ts.factory.createTupleTypeNode(
                parameterDefinitions.map((parameterDefinition) =>
                  this.buildParamTypeNode(parameterDefinition),
                ),
              ),
              resultType: this.buildReturnTypeNode(returnTypeDefinition),
            })),
          ),
        })),
      ),
    );

    const pgFn = this.createPgFn();

    return [pgFnNamesType, pgFnParamsType, pgFnReturnTypes, pgFn];
  }

  private getOverloads(functionDefinition: FunctionDefinition): {
    parameterDefinitions: OptionalParameterPermutation[];
    returnTypeDefinition: FunctionReturnTypeDefinition;
  }[] {
    return functionDefinition.overloadDefinitions
      .flatMap((overload) =>
        this.getOptionalParameterPermutations(
          overload.parameterDefinitions,
        ).map((permutation) => ({
          parameterDefinitions: permutation,
          returnTypeDefinition: overload.returnTypeDefinition,
        })),
      )
      .toSorted((a, b) => {
        const paramCountDiff =
          a.parameterDefinitions.length - b.parameterDefinitions.length;
        if (paramCountDiff !== 0) return paramCountDiff;
        return (
          this.countVariadicParams(a.parameterDefinitions) -
          this.countVariadicParams(b.parameterDefinitions)
        );
      });
  }

  private getOptionalParameterPermutations(
    params: FunctionParameterDefinition[],
  ): OptionalParameterPermutation[][] {
    const permutation: OptionalParameterPermutation[] = params.map((p) => ({
      tsType: p.tsType,
      isNullable: p.isNullable,
      isArray: p.isArray,
      isVariadic: p.isVariadic,
    }));

    const lastParam = params.at(-1);
    const rest = lastParam?.isOptional
      ? this.getOptionalParameterPermutations(params.slice(0, -1))
      : [];

    return [permutation, ...rest];
  }

  private countVariadicParams(params: OptionalParameterPermutation[]): number {
    return params.filter((p) => p.isVariadic).length;
  }

  private buildConditionalChain(
    checkType: TypeNode,
    branches: Array<{ extendsType: TypeNode; resultType: TypeNode }>,
  ): TypeNode {
    return branches.reduceRight(
      (falseType, { extendsType, resultType }) =>
        ts.factory.createConditionalTypeNode(
          checkType,
          extendsType,
          resultType,
          falseType,
        ),
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword) as TypeNode,
    );
  }

  private buildParamTypeNode(param: OptionalParameterPermutation): TypeNode {
    let type = this.tsTypeToTypeNode(param.tsType);

    if (param.isArray && !param.isVariadic) {
      type = ts.factory.createArrayTypeNode(type);
    }

    type = this.applyNullable(type, param.isNullable);

    type = ts.factory.createTypeReferenceNode("Expression", [type]);

    if (param.isVariadic) {
      type = ts.factory.createRestTypeNode(
        ts.factory.createArrayTypeNode(type),
      );
    }

    return type;
  }

  private buildReturnTypeNode(
    returnType: FunctionReturnTypeDefinition,
  ): TypeNode {
    let type = this.tsTypeToTypeNode(returnType.tsType);

    if (returnType.isArray) {
      type = ts.factory.createArrayTypeNode(type);
    }

    type = this.applyNullable(type, returnType.isNullable);

    return type;
  }

  private createPgFn() {
    return ts.factory.createFunctionDeclaration(
      [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
      undefined,
      "pgFn",
      [
        ts.factory.createTypeParameterDeclaration(
          undefined,
          ts.factory.createIdentifier("T"),
          ts.factory.createTypeReferenceNode("PgFnNames"),
        ),
        ts.factory.createTypeParameterDeclaration(
          undefined,
          ts.factory.createIdentifier("V"),
          ts.factory.createTypeReferenceNode("PgFnParams", [
            ts.factory.createTypeReferenceNode("T"),
          ]),
        ),
      ],
      [
        ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          "fn",
          undefined,
          ts.factory.createTypeReferenceNode("T"),
        ),
        ts.factory.createParameterDeclaration(
          undefined,
          undefined,
          "args",
          undefined,
          ts.factory.createTypeReferenceNode("V"),
        ),
      ],
      ts.factory.createTypeReferenceNode("RawBuilder", [
        ts.factory.createTypeReferenceNode("PgFnReturnTypes", [
          ts.factory.createTypeReferenceNode("T"),
          ts.factory.createTypeReferenceNode("V"),
        ]),
      ]),
      ts.factory.createBlock(
        [
          ts.factory.createReturnStatement(
            ts.factory.createTaggedTemplateExpression(
              ts.factory.createIdentifier("sql"),
              [
                ts.factory.createTypeReferenceNode("PgFnReturnTypes", [
                  ts.factory.createTypeReferenceNode("T"),
                  ts.factory.createTypeReferenceNode("V"),
                ]),
              ],
              ts.factory.createTemplateExpression(
                ts.factory.createTemplateHead(""),
                [
                  ts.factory.createTemplateSpan(
                    ts.factory.createCallExpression(
                      ts.factory.createPropertyAccessExpression(
                        ts.factory.createIdentifier("sql"),
                        "raw",
                      ),
                      undefined,
                      [ts.factory.createIdentifier("fn")],
                    ),
                    ts.factory.createTemplateMiddle("("),
                  ),
                  ts.factory.createTemplateSpan(
                    ts.factory.createCallExpression(
                      ts.factory.createPropertyAccessExpression(
                        ts.factory.createIdentifier("sql"),
                        "join",
                      ),
                      undefined,
                      [ts.factory.createIdentifier("args")],
                    ),
                    ts.factory.createTemplateTail(")"),
                  ),
                ],
              ),
            ),
          ),
        ],
        true,
      ),
    );
  }

  private genImportStatements() {
    return ts.factory.createImportDeclaration(
      undefined,
      ts.factory.createImportClause(
        false,
        undefined,
        ts.factory.createNamedImports(
          this.kyselyImports.map(({ value, isTypeImport }) => {
            return ts.factory.createImportSpecifier(
              isTypeImport,
              undefined,
              ts.factory.createIdentifier(value),
            );
          }),
        ),
      ),
      ts.factory.createStringLiteral("kysely", true),
    );
  }

  private tsTypeToTypeNode(tsType: TsType): TypeNode {
    return typeof tsType === "object"
      ? this.createEnumTypeNode(tsType)
      : ts.factory.createTypeReferenceNode(tsType, undefined);
  }

  private createEnumTypeNode({ enumSchema, enumName }: EnumStub) {
    const values =
      this.schemaDefinitions
        .find((schemaDefinition) => schemaDefinition.pgName === enumSchema)
        ?.enumDefinitions.find(
          (enumDefinition) => enumDefinition.pgName === enumName,
        )?.values ?? [];

    return values.length > 0
      ? ts.factory.createUnionTypeNode(
          values.map((value) =>
            ts.factory.createLiteralTypeNode(
              ts.factory.createStringLiteral(value),
            ),
          ),
        )
      : ts.factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword);
  }

  private applyNullable(typeNode: TypeNode, isNullable: boolean): TypeNode {
    if (!isNullable) return typeNode;
    return ts.factory.createUnionTypeNode([
      typeNode,
      ts.factory.createLiteralTypeNode(ts.factory.createNull()),
    ]);
  }

  private applyTSDocComment<T extends PropertySignature>(
    propertySignature: T,
    tsDocComment?: string,
  ) {
    if (tsDocComment) {
      tsDocComment = tsDocComment.slice(
        tsDocComment.indexOf("/*") + "/*".length,
        tsDocComment.lastIndexOf("*/"),
      );

      propertySignature = ts.addSyntheticLeadingComment(
        propertySignature,
        ts.SyntaxKind.MultiLineCommentTrivia,
        tsDocComment,
        true,
      );
    }

    return propertySignature;
  }

  private formatOutput(output: string) {
    return synchronizedPrettier
      .format(output, {
        parser: "typescript",
        plugins: [require.resolve("prettier-plugin-jsdoc")],
        printWidth: 80,
        tsDoc: true,
        jsdocPreferCodeFences: true,
      })
      .trim();
  }
}
