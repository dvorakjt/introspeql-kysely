# IntrospeQL-Kysely

IntrospeQL-Kysely reads information from your PostgreSQL database and generates 
a type definition file that is compatible with Kysely. 

## Example Usage

```typescript
// src/model/point.ts
export interface Point {
  latitude: number;
  longitude: number;
}
```

```typescript
// src/scripts/gen-types.ts
import 'dotenv/config'; // must have dotenv installed
import path from 'node:path';
import { 
  introspeqlKysely, 
  type IntrospeqlKyselyConfig 
} from 'introspeql-kysely';

const outFile = '/model/db.ts';

const config: IntrospeqlKyselyConfig = {
  schemas: ['public'], // Add other schemas as necessary
  dbConnectionParams: { // These values should be declared in a .env file
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT!,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },
  writeToDisk: true,
  outFile: path.join(__dirname, '..' + outFile),  
  header:
    "import type { Point } from './point';" 
  types: {
    'public.geography' : 'Point'
  }
};

genTypes();

async function genTypes() {
  await introspeql(config);
  console.log("Type definition file created at " + outFile);
}
```

```typescript
// src/main.ts
import { pgFn, type DB } from './model/db';

const result = await db
  .selectFrom('public.locations') // Assumes there is a table called locations
  .select((eb) => [
    pgFn('public.st_distance', [
      eb.ref('coordinates'),
      eb.val({
        latitude: 39.95295623565238, 
        longitude: -75.16348330361122
      })
    ]).as('distance_to_philadelphia')
  ]).execute();
```

## Further Reading

