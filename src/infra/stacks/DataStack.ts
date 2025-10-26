import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { getSuffixFromStack } from "../Utils";
import { SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
  CfnGlobalCluster,
  CfnDBCluster,
} from "aws-cdk-lib/aws-rds";
import { ISecret, Secret } from "aws-cdk-lib/aws-secretsmanager";

interface DataStackProps extends StackProps {
  vpc: Vpc;
  isGlobalPrimary?: boolean;
  globalClusterId?: string;
  // secretReplicaRegions?: string[];
}

export class DataStack extends Stack {
  public readonly spacesTable: Table;
  public readonly auroraCluster: DatabaseCluster;
  public readonly dbSecret: ISecret;
  public readonly dbSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const suffix = getSuffixFromStack(this);
    const isPrimary = props.isGlobalPrimary ?? true;
    const globalClusterId = props.globalClusterId ?? "spacefinder-global-db";
    const secretName = "SpaceFinder-Aurora-Secret";

    // DynamoDB table for spaces
    const spacesTable = new Table(this, "SpacesTable", {
      tableName: `SpacesTable-${suffix}`,
      partitionKey: { name: "id", type: AttributeType.STRING },
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Create or import multi-region database credentials secret
    // const dbSecret: ISecret = isPrimary
    //   ? new Secret(this, `AuroraSecret-${suffix}`, {
    //       secretName: secretName,
    //       generateSecretString: {
    //         secretStringTemplate: JSON.stringify({ username: "postgres" }),
    //         generateStringKey: "password",
    //         excludePunctuation: true,
    //         includeSpace: false,
    //         passwordLength: 32,
    //       },
    //       // replicaRegions: (props.secretReplicaRegions ?? []).map((region) => ({ region })),
    //     })
    // : Secret.fromSecretNameV2(this, "AuroraSecretReplica", secretName);

    const dbSecret: ISecret = new Secret(this, `AuroraSecret`, {
      secretName: secretName,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "postgres" }),
        generateStringKey: "password",
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // Security group for Aurora cluster
    const dbSecurityGroup = new SecurityGroup(this, `AuroraSecurityGroup`, {
      vpc: props.vpc,
      description: "Security group for Aurora Serverless v2 cluster",
      allowAllOutbound: true,
    });

    const auroraCluster = new DatabaseCluster(this, `AuroraCluster`, {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_16_6,
      }),
      credentials: Credentials.fromSecret(dbSecret),
      defaultDatabaseName: "spacefinder",
      writer: ClusterInstance.serverlessV2("writer", {
        autoMinorVersionUpgrade: true,
      }),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbSecurityGroup],
    });

    // // Create Aurora Global Database (primary creates global cluster) and regional Serverless v2 PostgreSQL cluster
    // const global = isPrimary
    //   ? new CfnGlobalCluster(this, "GlobalCluster", {
    //       globalClusterIdentifier: globalClusterId,
    //       engine: "aurora-postgresql",
    //       engineVersion: "16.6",
    //       storageEncrypted: true,
    //     })
    //   : undefined;

    // // Create Aurora Serverless v2 PostgreSQL cluster
    // const auroraCluster = new DatabaseCluster(this, "AuroraCluster", {
    //   engine: DatabaseClusterEngine.auroraPostgres({
    //     version: AuroraPostgresEngineVersion.VER_16_6,
    //   }),
    //   credentials: Credentials.fromSecret(dbSecret),
    //   defaultDatabaseName: "spacefinder",
    //   writer: ClusterInstance.serverlessV2("writer", {
    //     autoMinorVersionUpgrade: true,
    //   }),
    //   readers: [
    //     // Optional: Add reader instance for production workloads
    //     // ClusterInstance.serverlessV2("reader", {
    //     //   scaleWithWriter: true,
    //     // }),
    //   ],
    //   vpc: props.vpc,
    //   vpcSubnets: {
    //     subnetType: SubnetType.PRIVATE_WITH_EGRESS,
    //   },
    //   securityGroups: [dbSecurityGroup],
    //   serverlessV2MinCapacity: 0.5, // Minimum for Aurora Serverless v2
    //   serverlessV2MaxCapacity: 1, // Adjust based on your needs
    //   removalPolicy: RemovalPolicy.SNAPSHOT, // Take snapshot before deletion
    //   backup: {
    //     retention: require("aws-cdk-lib").Duration.days(7),
    //   },
    // });

    // // Attach regional cluster to the Global Cluster
    // const cfnCluster = auroraCluster.node.defaultChild as CfnDBCluster;
    // cfnCluster.globalClusterIdentifier = global
    //   ? (global.globalClusterIdentifier as string)
    //   : globalClusterId;
    // if (global) {
    //   cfnCluster.addDependency(global);
    // }

    this.spacesTable = spacesTable;
    this.auroraCluster = auroraCluster;
    this.dbSecret = dbSecret;
    this.dbSecurityGroup = dbSecurityGroup;
  }
}
