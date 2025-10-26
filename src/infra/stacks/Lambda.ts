import { Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Runtime, StartingPosition } from "aws-cdk-lib/aws-lambda";
import { join } from "path";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Effect, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { DatabaseCluster } from "aws-cdk-lib/aws-rds";
import { ISecret } from "aws-cdk-lib/aws-secretsmanager";

interface LambdaStackProps extends StackProps {
  spacesTable: Table;
  vpc: Vpc;
  auroraCluster: DatabaseCluster;
  dbSecret: ISecret;
  dbSecurityGroup: SecurityGroup;
}

export class LambdaStack extends Stack {
  public readonly spacesLambdaIntegration: LambdaIntegration;
  public readonly sqlReplicatorLambdaIntegration: LambdaIntegration;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const spacesLambda = new NodejsFunction(this, "SpacesLambda", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler",
      entry: join(__dirname, "..", "..", "services", "spaces.ts"),
      environment: {
        TABLE_NAME: props.spacesTable.tableName,
      },
    });

    spacesLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [props.spacesTable.tableArn],
        actions: [
          "dynamodb:PutItem",
          "dynamodb:Scan",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
        ],
      })
    );

    const sqlReplicatorLambda = new NodejsFunction(this, "sqlReplicator", {
      runtime: Runtime.NODEJS_22_X,
      handler: "handler",
      entry: join(__dirname, "..", "..", "services", "sqlReplicator.ts"),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        TABLE_NAME: props.spacesTable.tableName,
        DB_SECRET_ARN: props.dbSecret.secretArn,
        DB_HOST: props.auroraCluster.clusterEndpoint.hostname,
        DB_PORT: props.auroraCluster.clusterEndpoint.port.toString(),
        DB_NAME: "spacefinder",
      },
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [props.dbSecurityGroup],
    });

    // Grant access to read the database secret
    props.dbSecret.grantRead(sqlReplicatorLambda);

    // Allow Lambda to connect to Aurora
    props.auroraCluster.connections.allowDefaultPortFrom(sqlReplicatorLambda);

    sqlReplicatorLambda.addEventSource(
      new DynamoEventSource(props.spacesTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 1,
        enabled: true,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        maxBatchingWindow: Duration.seconds(0),
        maxRecordAge: Duration.seconds(60),
        retryAttempts: 1,
      })
    );

    this.spacesLambdaIntegration = new LambdaIntegration(spacesLambda);
    this.sqlReplicatorLambdaIntegration = new LambdaIntegration(
      sqlReplicatorLambda
    );
  }
}
