import { DynamoDBStreamEvent, Context } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { Pool } from "pg";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

/**
 * SQL Replicator Lambda Handler
 *
 * This Lambda is triggered by DynamoDB Streams and replicates
 * space entries from DynamoDB to Aurora PostgreSQL using pg library.
 *
 * Event Flow:
 * 1. User creates/updates/deletes a space in DynamoDB (via API)
 * 2. DynamoDB Stream triggers this Lambda
 * 3. Lambda replicates the change to Aurora PostgreSQL
 */

// Connection pool singleton (reused across warm Lambda invocations)
let pool: Pool | null = null;

/**
 * Get or create PostgreSQL connection pool
 */
async function getPool(): Promise<Pool> {
  if (pool) {
    return pool;
  }

  // Fetch database credentials from Secrets Manager
  const secretsClient = new SecretsManagerClient({});
  const secretArn = process.env.DB_SECRET_ARN!;

  const response = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: secretArn })
  );

  const secret = JSON.parse(response.SecretString!);

  // Create connection pool
  pool = new Pool({
    host: process.env.DB_HOST!,
    port: parseInt(process.env.DB_PORT || "5432"),
    database: process.env.DB_NAME!,
    user: secret.username,
    password: secret.password,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  console.log("Database connection pool created");
  return pool;
}

async function handler(
  event: DynamoDBStreamEvent,
  context: Context
): Promise<void> {
  console.log("SQL Replicator triggered", JSON.stringify(event, null, 2));

  try {
    const db = await getPool();

    for (const record of event.Records) {
      console.log(`Processing record: ${record.eventID}`);
      console.log(`Event type: ${record.eventName}`);

      if (record.eventName === "INSERT" || record.eventName === "MODIFY") {
        // Handle INSERT and UPDATE events
        if (!record.dynamodb?.NewImage) {
          console.warn("No NewImage in record, skipping");
          continue;
        }

        const newImage = unmarshall(
          record.dynamodb.NewImage as Record<string, AttributeValue>
        );

        console.log("Upserting space to Aurora:", newImage);

        // Upsert space to PostgreSQL using ON CONFLICT
        await db.query(
          `INSERT INTO app.spaces (id, name, location, capacity, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id)
           DO UPDATE SET
             name = EXCLUDED.name,
             location = EXCLUDED.location,
             capacity = EXCLUDED.capacity,
             updated_at = EXCLUDED.updated_at`,
          [
            newImage.id,
            newImage.name,
            newImage.location,
            newImage.photoUrl || null,
            new Date(), // created_at (only used on INSERT)
            new Date(), // updated_at (always updated)
          ]
        );

        console.log(`Successfully upserted space: ${newImage.id}`);
      } else if (record.eventName === "REMOVE") {
        // Handle DELETE events
        if (!record.dynamodb?.OldImage) {
          console.warn("No OldImage in record, skipping");
          continue;
        }

        const oldImage = unmarshall(
          record.dynamodb.OldImage as Record<string, AttributeValue>
        );

        console.log("Deleting space from Aurora:", oldImage);

        // Delete space from PostgreSQL
        await db.query(`DELETE FROM app.spaces WHERE id = $1`, [oldImage.id]);

        console.log(`Successfully deleted space: ${oldImage.id}`);
      }
    }

    console.log("All records processed successfully");
  } catch (error: any) {
    console.error("Error processing DynamoDB stream:", error);
    throw error; // Trigger Lambda retry
  }
}

export { handler };
