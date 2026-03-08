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
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { pgFn, type DB } from './model/db';

const dialect = new PostgresDialect({
  pool: new Pool({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT!,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: 10,
  })
})

const db = new Kysely<DB>({
  dialect
});

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

- Kysely: https://kysely.dev/
- IntrospeQL: https://github.com/dvorakjt/introspeql
- node-postgres: https://node-postgres.com/

## License

MIT License

Copyright (c) 2026 Joseph Dvorak

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
