import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { Context } from "aws-lambda";
import { postSpaces } from "./PostSpaces";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const ddbClient = new DynamoDBClient({});

async function handler(event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> {
    let response: APIGatewayProxyResult;

    try {
        switch (event.httpMethod) {
            case "POST":
                const postResponse = await postSpaces(event, ddbClient);
                response = postResponse;
                break;
            default:
                response = {
                    statusCode: 405,
                    body: JSON.stringify({ message: "Method not allowed" })
                }
        }
    } catch (error) {
        response = {
            statusCode: 500,
            body: JSON.stringify({ message: error.message })
        }
    }
    return response;
}

export { handler }