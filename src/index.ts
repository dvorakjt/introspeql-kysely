import { introspeql, type IntrospeQLConfig } from "introspeql";
import { KyselyTypeGenerator } from "./kysely-type-generator";

export type IntrospeqlKyselyConfig = Omit<
  IntrospeQLConfig,
  "createTypeDefinitions"
>;

export function introspeqlKysely(config: IntrospeqlKyselyConfig) {
  return introspeql({
    ...(config as IntrospeQLConfig),
    createTypeDefinitions: (schemaDefinitions) => {
      return new KyselyTypeGenerator(schemaDefinitions).genTypes();
    },
  });
}
