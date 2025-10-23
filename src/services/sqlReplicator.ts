import { DynamoDBStreamEvent, Context } from "aws-lambda";
import { getPrismaClient } from "./shared/PrismaClient";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { AttributeValue } from "@aws-sdk/client-dynamodb";

/**
 * SQL Replicator Lambda Handler
 *
 * This Lambda is triggered by DynamoDB Streams and replicates
 * space entries from DynamoDB to Aurora PostgreSQL using Prisma.
 *
 * Event Flow:
 * 1. User creates/updates/deletes a space in DynamoDB (via API)
 * 2. DynamoDB Stream triggers this Lambda
 * 3. Lambda replicates the change to Aurora PostgreSQL
 */
async function handler(
  event: DynamoDBStreamEvent,
  context: Context
): Promise<void> {
  console.log("SQL Replicator triggered", JSON.stringify(event, null, 2));

  try {
    const prisma = await getPrismaClient();

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

        // Upsert space to PostgreSQL
        await prisma.space.upsert({
          where: { id: newImage.id },
          update: {
            name: newImage.name,
            location: newImage.location,
            photoUrl: newImage.photoUrl || null,
            updatedAt: new Date(),
          },
          create: {
            id: newImage.id,
            name: newImage.name,
            location: newImage.location,
            photoUrl: newImage.photoUrl || null,
          },
        });

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
        await prisma.space.delete({
          where: { id: oldImage.id },
        });

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